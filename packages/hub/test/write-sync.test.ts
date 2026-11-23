import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createHubServer } from '../src/server.ts'

const board = 'Board.canvas'
const node = (id: string) => ({ id, type: 'text', x: 0, y: 0, width: 120, height: 80, text: id })
const original = { nodes: [node('a'), node('b')], edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }] }
let dir: string, file: string, client: Client, hub: ReturnType<typeof createHubServer>
let version: { workspaceId: string; revision: string; cursor: string }
const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args })
const edit = (ops: unknown[], extras = {}) => call('apply_ops', { board, workspaceId: version.workspaceId, expectedRevision: version.revision, ops, ...extras })
const setText = { op: 'update_node', id: 'a', patch: { text: 'requested' } }
const get = async () => JSON.parse(await readFile(file, 'utf8'))
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'canvas-write-'))
  file = path.join(dir, board)
  await writeFile(file, JSON.stringify(original))
  client = new Client({ name: 'test', version: '1' }); hub = createHubServer(dir)
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(a), hub.connect(b)])
  version = (await call('open_canvas', { board })).structuredContent as typeof version
})
afterEach(async () => { await client.close(); await hub.close(); await rm(dir, { recursive: true, force: true }) })

it('rebases on saved coordinates and unrelated fields and reports overlapping text without overwriting it', async () => {
  const external = await get()
  external.nodes[0].x = 500; external.nodes[1].text = 'edited elsewhere'; external.custom = ['keep']
  await writeFile(file, JSON.stringify(external))
  const applied = await edit([setText])
  expect(applied.structuredContent).toMatchObject({ rebased: true })
  expect(await get()).toEqual({ ...external, nodes: [{ ...external.nodes[0], text: 'requested' }, external.nodes[1]] })
  const competing = await edit([{ ...setText, patch: { text: 'stale alternative' } }])
  expect(competing.isError).toBe(true)
  expect((await get()).nodes[0].text).toBe('requested')
})
it('recovers after a transient path replacement and never recreates a permanently missing file', async () => {
  const moved = path.join(dir, 'renamed')
  await rename(file, moved)
  const pending = edit([setText])
  await new Promise(resolve => setTimeout(resolve, 60))
  await rename(moved, file)
  expect((await pending).isError).not.toBe(true)
  await rename(file, moved)
  const missing = await edit([setText])
  expect(missing.structuredContent).toMatchObject({ issue: { code: 'missing_file', path: board } })
  await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' })
})
it('rejects a whole batch when a referenced card vanished and sends its warning to the originating panel', async () => {
  const scope = { workspaceId: version.workspaceId, sessionId: 'first' }
  const ref = (await call('create_reference', { ...scope, board, nodeIds: ['b'], edgeIds: [], revision: version.revision })).structuredContent as { id: string }
  const reduced = { nodes: [original.nodes[0]], edges: [] }
  await writeFile(file, JSON.stringify(reduced))
  const rejected = await edit([setText, { op: 'add_node', node: node('c') }], { referenceId: ref.id })
  expect(rejected.structuredContent).toMatchObject({ issue: { code: 'missing_targets', nodeIds: ['b'] } })
  const events = (await call('wait_for_changes', { ...scope, cursor: version.cursor })).structuredContent as any
  expect(events.changes).toContainEqual(expect.objectContaining({ type: 'write_warning', issue: expect.objectContaining({ nodeIds: ['b'] }) }))
  const other = await call('wait_for_changes', { ...scope, sessionId: 'other', cursor: version.cursor })
  expect((other.structuredContent as any).changes.some((v: any) => v.type === 'write_warning')).toBe(false)
  expect(await get()).toEqual(reduced)
  expect((await edit([{ op: 'add_edge', edge: { id: 'f', fromNode: 'a', toNode: 'b' } }])).structuredContent).toMatchObject({ issue: { nodeIds: ['b'] } })
  expect((await edit([{ op: 'update_edge', id: 'e', patch: { label: 'changed' } }])).structuredContent).toMatchObject({ issue: { edgeIds: ['e'] } })
})

it('delivers a rejected write to a panel served by another hub on the same vault', async () => {
  const viewer = new Client({ name: 'viewer', version: '1' }), otherHub = createHubServer(dir)
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([viewer.connect(a), otherHub.connect(b)])
  try {
    const open = await viewer.callTool({ name: 'get_preview', arguments: { board } })
    let cursor = (open.structuredContent as typeof version).cursor
    expect((await edit([{ ...setText, id: 'gone' }])).isError).toBe(true)
    for (;;) {
      const notification = await viewer.callTool({ name: 'wait_for_changes', arguments: { workspaceId: version.workspaceId, cursor, sessionId: 'viewer' } })
      const batch = notification.structuredContent as { cursor: string; changes: import('@better-canvas/core').PanelChange[] }
      const warning = batch.changes.find(c => c.type === 'write_warning')
      if (warning) { expect(warning.issue.nodeIds).toEqual(['gone']); break }
      cursor = batch.cursor
    }
  } finally { await viewer.close(); await otherHub.close() }
})

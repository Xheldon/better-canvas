import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import WebSocket from 'ws'
import { Workspace } from '../src/workspace.ts'
import { startServe, type RunningServer } from '../src/serve.ts'
import { createHubServer } from '../src/server.ts'

const roots: string[] = []
let running: RunningServer | undefined, client: Client | undefined
afterEach(async () => {
  await client?.close(); client = undefined
  await running?.close(); running = undefined
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const original = JSON.stringify({ nodes: [{ id: 'a', type: 'text', text: 'Same content', x: 30, y: -20, width: 200, height: 100 }], edges: [] })
async function setup() {
  const temp = await mkdtemp(path.join(tmpdir(), 'canvas-directory-')); roots.push(temp)
  const a = path.join(temp, 'one'), b = path.join(temp, 'two')
  for (const root of [a, b]) { await mkdir(root); await writeFile(path.join(root, 'Same.canvas'), original) }
  const config = path.join(temp, 'preferences/settings.json')
  const workspace = new Workspace('', config)
  running = await startServe(workspace, { port: 0 })
  const base = 'http://127.0.0.1:' + running.port
  const post = (route: string, value: unknown) => fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
  const server = createHubServer(workspace)
  client = new Client({ name: 'settings-test', version: '1' })
  const pair = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(pair[0]), server.connect(pair[1])])
  return { a, b, config, workspace, base, post }
}
const call = async (name: string, args: Record<string, unknown> = {}) => client!.callTool({ name, arguments: args })

it('starts with a chooser, saves an ordinary directory, and restores it without scanning the cwd', async () => {
  const { a, b, config, workspace, base, post } = await setup()
  const initial = await (await fetch(base + '/api/preview')).json() as any
  expect(initial).toMatchObject({ needsVault: true, boards: [], directory: '' })
  await mkdir(path.join(a, 'Planning', 'Week 1'), { recursive: true })
  await mkdir(path.join(a, 'Notes only')); await writeFile(path.join(a, 'Notes only', 'Notes.md'), 'Hidden in the tree')
  await writeFile(path.join(a, 'Planning', 'Week 1', 'Review.canvas'), original)
  await mkdir(path.join(a, '.hidden')); await writeFile(path.join(a, '.hidden', 'Secret.canvas'), original)
  const response = await post('/api/directory', { path: a, workspaceId: initial.workspaceId })
  expect(response.status).toBe(200)
  const snapshot = await response.json() as any
  expect(snapshot.boards.map((x: any) => x.path)).toEqual(['Planning/Week 1/Review.canvas', 'Same.canvas'])
  expect(snapshot.directory).toBe(await realpath(a))
  expect(snapshot.workspaceId).not.toBe(initial.workspaceId)
  expect(JSON.parse(await readFile(config, 'utf8'))).toEqual({ directory: await realpath(a) })
  const restored = new Workspace('', config); await restored.restore()
  expect(restored.root).toBe(workspace.root)
  expect(restored.id).toBe(workspace.id)
  const next = await call('set_directory', { path: b, workspaceId: snapshot.workspaceId })
  expect(next.isError).not.toBe(true)
  expect((await (await fetch(base + '/api/preview')).json() as any).directory).toBe(await realpath(b))
})

it('keeps the current directory after invalid, relative, file, stale, or cross-origin setting requests', async () => {
  const { a, b, config, workspace, post, base } = await setup()
  await workspace.select(a)
  const saved = await readFile(config, 'utf8'), id = workspace.id
  for (const selected of ['', 'relative/folder', path.join(a, 'missing'), path.join(a, 'Same.canvas')]) {
    const response = await post('/api/directory', { path: selected, workspaceId: id })
    expect(response.ok).toBe(false)
  }
  expect((await post('/api/directory', { path: b, workspaceId: 'old' })).ok).toBe(false)
  expect((await post('/api/directory', { path: b })).ok).toBe(false)
  expect((await fetch(base + '/api/directory', { method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json' }, body: JSON.stringify({ path: b, workspaceId: id }) })).status).toBe(403)
  expect(workspace.id).toBe(id)
  expect(await readFile(config, 'utf8')).toBe(saved)
  await writeFile(config, JSON.stringify({ directory: path.join(a, 'removed') }))
  const restored = new Workspace('', config); await restored.restore()
  expect(restored.root).toBe('')
})

it('rejects an old reference and edits after a directory switch even with identical names, IDs and revision', async () => {
  const { a, b, workspace, post, base } = await setup()
  await workspace.select(a)
  const before = (await call('read_board', { board: 'Same.canvas' })).structuredContent as any
  const selection = { workspaceId: before.workspaceId, sessionId: 'panel', board: 'Same.canvas', nodeIds: ['a'], edgeIds: [], revision: before.revision }
  const ref = (await call('create_reference', selection)).structuredContent as any
  await workspace.select(b)
  const preview = await (await fetch(base + '/api/preview?board=old-only.canvas&workspaceId=' + before.workspaceId)).json() as any
  expect(preview.board).toBe('Same.canvas')
  expect(preview.revision).toBe(before.revision)
  expect(preview.workspaceId).not.toBe(before.workspaceId)
  expect((await post('/api/reference', selection)).ok).toBe(false)
  expect((await post('/api/selection', selection)).ok).toBe(false)
  expect((await call('read_reference', { id: ref.id, workspaceId: before.workspaceId })).isError).toBe(true)
  const edit = { board: 'Same.canvas', workspaceId: before.workspaceId, expectedRevision: before.revision, ops: [{ op: 'update_node', id: 'a', patch: { text: 'Wrong directory' } }] }
  expect((await call('apply_ops', edit)).isError).toBe(true)
  expect((await call('create_board', { board: 'Wrong.canvas', workspaceId: before.workspaceId })).isError).toBe(true)
  expect(await readFile(path.join(a, 'Same.canvas'), 'utf8')).toBe(original)
  expect(await readFile(path.join(b, 'Same.canvas'), 'utf8')).toBe(original)
  const accepted = await call('apply_ops', { ...edit, workspaceId: preview.workspaceId })
  expect(accepted.isError).not.toBe(true)
  expect(await readFile(path.join(a, 'Same.canvas'), 'utf8')).toBe(original)
  expect(JSON.parse(await readFile(path.join(b, 'Same.canvas'), 'utf8')).nodes[0].text).toBe('Wrong directory')
})

it('serializes directory changes with in-flight edits and rejects a competing stale switch', async () => {
  const { a, b, workspace, config } = await setup()
  await workspace.select(a)
  const id = workspace.id
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const edit = workspace.scoped(id, async root => { await gate; await writeFile(path.join(root, 'Note.md'), 'Scoped to the original directory') })
  const firstSwitch = workspace.select(b, id)
  const secondSwitch = workspace.select(a, id)
  // Attach rejection handling before releasing the queued operations.
  const results = Promise.allSettled([edit, firstSwitch, secondSwitch])
  release()
  expect((await results).map(r => r.status)).toEqual(['fulfilled', 'fulfilled', 'rejected'])
  expect(await readFile(path.join(a, 'Note.md'), 'utf8')).toContain('original directory')
  await expect(readFile(path.join(b, 'Note.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(JSON.parse(await readFile(config, 'utf8')).directory).toBe(await realpath(b))
})

it('moves filesystem notifications to the selected directory without changing the browser URL', async () => {
  const { a, b, workspace, base, post } = await setup()
  await workspace.select(a)
  const messages: any[] = []
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws')
  ws.on('message', data => messages.push(JSON.parse(String(data))))
  await new Promise<void>(resolve => ws.once('open', resolve))
  try {
    expect((await post('/api/directory', { path: b, workspaceId: workspace.id })).ok).toBe(true)
    await writeFile(path.join(a, 'Old-only.canvas'), original)
    await writeFile(path.join(b, 'New-only.canvas'), original)
    for (let i = 0; i < 60 && !messages.some(m => m.path === 'New-only.canvas'); i++) await delay(20)
    expect(messages).toContainEqual({ type: 'directory_changed' })
    expect(messages).toContainEqual({ type: 'board_changed', path: 'New-only.canvas' })
    expect(messages.some(m => m.path === 'Old-only.canvas')).toBe(false)
  } finally { ws.close() }
})

it('previews a local image file node next to a grouped step without adding an edge', async () => {
  const { a, workspace, base } = await setup()
  await workspace.select(a)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOfoAAAAASUVORK5CYII=', 'base64')
  await mkdir(path.join(a, 'Assets')); await writeFile(path.join(a, 'Assets', 'Example.png'), png)
  const data = { nodes: [
    { id: 'g', type: 'group', label: 'Step and illustration', x: -20, y: -20, width: 500, height: 250 },
    { id: 'step', type: 'text', text: 'Step', x: 0, y: 0, width: 200, height: 100 },
    { id: 'picture', type: 'file', file: 'Assets/Example.png', x: 240, y: 0, width: 200, height: 200 },
  ], edges: [] }
  await writeFile(path.join(a, 'Illustrated.canvas'), JSON.stringify(data))
  const board = (await call('read_board', { board: 'Illustrated.canvas' })).structuredContent as any
  expect(board.data).toEqual(data)
  const image = await (await fetch(base + '/api/file?path=Assets/Example.png&workspaceId=' + workspace.id)).json() as any
  expect(image.kind).toBe('image')
  expect(Buffer.from(image.src.split(',')[1], 'base64')).toEqual(png)
})

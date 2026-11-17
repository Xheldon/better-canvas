import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import WebSocket from 'ws'
import { createHubServer } from '../src/server.ts'
import { startServe, type RunningServer } from '../src/serve.ts'
import { excerpt, revisionOf, writeVersioned } from '../src/storage.ts'

let http: RunningServer | undefined
let client: Client | undefined
afterEach(async () => { await client?.close(); client = undefined; await http?.close(); http = undefined })
const result = (r: any) => JSON.parse(r.content[0].text)
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'better-canvas-'))
  await writeFile(path.join(root, 'Board.canvas'), JSON.stringify({ custom: { preserved: true }, nodes: [
    { id: 'a', type: 'text', text: 'Alpha', x: -130, y: 210, width: 333, height: 111, pluginField: 42 },
    { id: 'b', type: 'text', text: 'Beta', x: 400, y: 210, width: 200, height: 120 },
  ], edges: [{ id: 'e', fromNode: 'a', toNode: 'b', fromSide: 'bottom', toSide: 'top', toEnd: 'none' }] }))
  await writeFile(path.join(root, 'Note.md'), '# Note\n\n## One\n\nFirst\n\n## Two\n\nSecond\n')
  http = await startServe(root, { port: 0 })
  const server = createHubServer(root)
  const pair = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'bridge-test', version: '1' })
  await Promise.all([client.connect(pair[0]), server.connect(pair[1])])
  const base = `http://127.0.0.1:${http.port}`
  const get = () => fetch(`${base}/api/board?path=Board.canvas`).then(r => r.json()) as Promise<any>
  const post = (route: string, body: unknown, extra: Record<string,string> = {}) => fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) })
  return { root, base, get, post }
}

describe('browser, MCP and vault interoperability', () => {
  it('shares multi-selection, resolves a stable reference, and edits only the target', async () => {
    const { root, get, post } = await setup()
    const before = await get()
    const selection = { sessionId: 'tab-a', board: 'Board.canvas', nodeIds: ['a','b'], edgeIds: ['e'], revision: before.revision }
    expect((await post('/api/selection', selection)).ok).toBe(true)
    const selected = result(await client!.callTool({ name: 'get_selection', arguments: {} }))
    expect(selected.nodes.map((n:any) => n.id)).toEqual(['a','b'])
    const ref = await (await post('/api/reference', selection)).json() as any
    await post('/api/selection', { ...selection, nodeIds: ['b'], edgeIds: [] })
    const resolved = result(await client!.callTool({ name: 'read_reference', arguments: { id: ref.id } }))
    expect(resolved.nodeIds).toEqual(['a','b'])
    const edit = await client!.callTool({ name: 'apply_ops', arguments: { board: 'Board.canvas', expectedRevision: before.revision, ops: [{ op:'update_node', id:'a', patch:{text:'Changed through MCP'} }] } })
    expect(edit.isError).not.toBe(true)
    const next = await get()
    expect(next.data.nodes[0]).toMatchObject({ x:-130, y:210, width:333, height:111, pluginField:42, text:'Changed through MCP' })
    expect(next.data.nodes[1]).toEqual(before.data.nodes[1])
    expect(next.data.edges).toEqual(before.data.edges)
    expect(next.data.custom).toEqual(before.data.custom)
    expect(next.revision).not.toBe(before.revision)
    const history = path.join(root, '.better-canvas/history', revisionOf('Board.canvas'))
    expect((await readdir(history)).length).toBe(1)
    expect(result(await client!.callTool({ name:'read_reference', arguments:{ id:ref.id } })).stale).toBe(true)
    expect((await post('/api/reference', selection)).status).toBe(409)
  })

  it('blocks browser writes and rejects stale or competing MCP edits', async () => {
    const { root, get, post } = await setup()
    const before = await get()
    const external = { ...before.data, external: true }
    await writeFile(path.join(root, 'Board.canvas'), JSON.stringify(external))
    const stale = await post('/api/mutate', { board:'Board.canvas', expectedRevision:before.revision, changes:[{kind:'set_text',id:'a',text:'stale'}] })
    expect(stale.status).toBe(405)
    const ai = await client!.callTool({ name:'apply_ops', arguments:{ board:'Board.canvas', expectedRevision:before.revision, ops:[{op:'update_node',id:'a',patch:{text:'stale AI'}}] } })
    expect(ai.isError).toBe(true)
    expect((await get()).data).toEqual(external)
    const version = (await get()).revision
    const responses = await Promise.all(['one','two'].map(text => client!.callTool({ name:'apply_ops', arguments:{board:'Board.canvas',expectedRevision:version,ops:[{op:'update_node',id:'a',patch:{text}}]} })))
    expect(responses.filter(r=>r.isError).length).toBe(1)
    expect((await get()).data.external).toBe(true)
    expect((await post('/api/mutate',{board:'Board.canvas',changes:[{kind:'set_text',id:'a',text:'no revision'}]})).status).toBe(405)
  })

  it('refreshes note files, detects external Canvas changes, and serves only a heading', async () => {
    const { root, base } = await setup()
    const messages: any[] = []
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws')
    ws.on('message', d => messages.push(JSON.parse(String(d))))
    await new Promise<void>(resolve => ws.once('open', resolve))
    await writeFile(path.join(root,'Note.md'), '# Note\n\n## One\n\nNew text\n\n## Two\n\nSecond\n')
    const b = JSON.parse(await readFile(path.join(root,'Board.canvas'),'utf8')); b.nodes[0].x = -999
    await writeFile(path.join(root,'Board.canvas'),JSON.stringify(b))
    for (let i=0;i<50 && (!messages.some(m=>m.type==='file_changed') || !messages.some(m=>m.type==='board_changed'));i++) await delay(20)
    expect(messages.some(m=>m.type==='file_changed' && m.path==='Note.md')).toBe(true)
    expect(messages.some(m=>m.type==='board_changed')).toBe(true)
    const excerpt = await (await fetch(base+'/api/file?path=Note.md&subpath=%23One')).json() as any
    expect(excerpt.text).toBe('## One\n\nNew text')
    ws.close()
  })

  it('refuses cross-origin requests, symlink escapes, and ambiguous browser sessions', async () => {
    const { root, base, get, post } = await setup()
    expect((await fetch(base+'/api/boards',{headers:{origin:'https://example.com'}})).status).toBe(403)
    const outside = await mkdtemp(path.join(tmpdir(),'outside-vault-'))
    await writeFile(path.join(outside,'Secret.md'),'outside')
    await symlink(outside,path.join(root,'escape'))
    expect((await fetch(base+'/api/file?path=escape/Secret.md')).ok).toBe(false)
    await expect(writeVersioned(root,'escape/New.md','no')).rejects.toThrow('Symlink')
    await symlink(outside,path.join(root,'assets'))
    const upload = await fetch(base+'/api/upload?name=sample.png', {method:'POST',body:new Uint8Array([137,80,78,71])})
    expect(upload.ok).toBe(false)
    expect(await readdir(outside)).toEqual(['Secret.md'])
    const b = await get()
    for (const sessionId of ['first','second']) await post('/api/selection',{sessionId,board:'Board.canvas',nodeIds:['a'],edgeIds:[],revision:b.revision})
    expect(result(await client!.callTool({name:'get_selection',arguments:{}})).status).toBe('ambiguous')
    expect(result(await client!.callTool({name:'get_selection',arguments:{sessionId:'first'}})).nodes[0].id).toBe('a')
  })
})

describe('Obsidian note excerpts', () => {
  it('includes child headings, skips fenced headings, and excludes the next peer', () => {
    expect(excerpt('# A\n## Target\ntext\n```\n# hidden\n```\n### Child\nx\n## Next\ny','#Target')).toBe('## Target\ntext\n```\n# hidden\n```\n### Child\nx')
  })
  it('resolves inline and standalone block references and reports missing targets', () => {
    expect(excerpt('before\n\nTarget paragraph ^block\n\nafter','#^block')).toBe('Target paragraph')
    expect(excerpt('before\n\nTarget paragraph\n\n^block\n','#^block')).toBe('Target paragraph')
    expect(() => excerpt('# Existing','#Missing')).toThrow('Heading not found')
  })
})

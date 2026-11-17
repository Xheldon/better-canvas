// Exercise the release ZIP, outside the checkout, through a real stdio MCP client.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'))
const temp = await mkdtemp(path.join(tmpdir(), 'better-canvas-package-'))
const client = new Client({ name: 'package-acceptance', version: '1.0.0' })
const decode = result => {
  assert.ok(!result.isError, result.content?.[0]?.text)
  return JSON.parse(result.content[0].text)
}
try {
  const archive = path.join(root, 'dist', `better-canvas-${manifest.version}.zip`)
  execFileSync('unzip', ['-q', archive, '-d', temp])
  const catalog = JSON.parse(await readFile(path.join(temp, 'better-canvas/.agents/plugins/marketplace.json'), 'utf8'))
  assert.equal(catalog.plugins[0].source.path, './')
  const entry = path.join(temp, 'better-canvas/packages/hub/dist/better-canvas.mjs')
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry, 'mcp', '--select-vault'], cwd: temp, stderr: 'pipe' })
  await client.connect(transport)
  const tools = (await client.listTools()).tools
  const panel = tools.find(t => t.name === 'open_canvas')
  assert.ok(panel._meta.ui.resourceUri)
  assert.deepEqual(tools.find(t => t.name === 'apply_ops')._meta.ui.visibility, ['model'])
  const resource = await client.readResource({uri: panel._meta.ui.resourceUri})
  assert.ok(resource.contents[0].text.includes('__BETTER_CANVAS_MCP__'))
  assert.ok(!resource.contents[0].text.includes('@xyflow'))
  assert.equal((await client.callTool({ name: 'list_boards', arguments: {} })).isError, true)

  const vault = path.join(temp, 'sample-vault')
  await mkdir(vault)
  const original = { extension: 'preserve', nodes: [
    { id: 'one', type: 'text', text: 'Original', x: -100, y: 40, width: 300, height: 180, extension: 7 },
    { id: 'two', type: 'file', file: 'Note.md', x: 300, y: 40, width: 300, height: 180 },
  ], edges: [] }
  await writeFile(path.join(vault, 'Board.canvas'), JSON.stringify(original))
  await writeFile(path.join(vault, 'Note.md'), '# Note\n\nOriginal note.\n')
  decode(await client.callTool({ name: 'open_vault', arguments: { path: vault } }))
  const preview = decode(await client.callTool({ name: 'start_preview', arguments: {} }))
  const html = await (await fetch(preview.url)).text()
  assert.ok(html.includes('Better Canvas'))
  const asset = /src="([^"]+\.js)"/.exec(html)?.[1]
  assert.ok(asset)
  assert.equal((await fetch(new URL(asset, preview.url))).status, 200)
  const boardResult = await client.callTool({ name: 'read_board', arguments: { board: 'Board.canvas' } })
  assert.ok(!boardResult.isError)
  const before = boardResult.structuredContent
  assert.deepEqual(before.data, original)
  const selection = { sessionId: 'package-test', board: 'Board.canvas', nodeIds: ['one','two'], edgeIds: [], revision: before.revision }
  const post = async (route, body) => fetch(new URL(route, preview.url), { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) })
  assert.equal((await post('/api/selection', selection)).status, 200)
  assert.equal(decode(await client.callTool({ name: 'get_selection', arguments: {} })).nodes.length, 2)
  const referenceResponse = await post('/api/reference', selection)
  assert.equal(referenceResponse.status, 200)
  const reference = await referenceResponse.json()
  await post('/api/selection', { ...selection, nodeIds: ['two'] })
  assert.deepEqual(decode(await client.callTool({ name: 'read_reference', arguments: { id: reference.id } })).nodeIds, ['one','two'])
  const edit = await client.callTool({ name: 'apply_ops', arguments: { board: 'Board.canvas', expectedRevision: before.revision, ops: [{ op: 'update_node', id: 'one', patch: {text: 'Edited through packaged MCP'} }] } })
  assert.ok(!edit.isError, edit.content?.[0]?.text)
  const saved = JSON.parse(await readFile(path.join(vault, 'Board.canvas'), 'utf8'))
  assert.deepEqual(saved, { ...original, nodes: [{ ...original.nodes[0], text: 'Edited through packaged MCP' }, original.nodes[1]] })
  assert.equal((await post('/api/mutate', { board:'Board.canvas', expectedRevision:before.revision, changes:[{kind:'set_text',id:'one',text:'stale'}] })).status, 405)
  const note = decode(await client.callTool({ name: 'read_note', arguments: { path: 'Note.md' } }))
  decode(await client.callTool({ name: 'update_note', arguments: { path: 'Note.md', text: '# Note\n\nUpdated note.\n', expectedRevision: note.revision } }))
  assert.equal(await readFile(path.join(vault, 'Note.md'), 'utf8'), '# Note\n\nUpdated note.\n')
  console.log('Release ZIP passed: standalone stdio, vault selection, bundled preview, multi-selection, stable references, read-only HTTP, exact MCP edits, MCP App resource, and linked notes.')
} finally {
  await client.close()
  await rm(temp, { recursive: true, force: true })
}

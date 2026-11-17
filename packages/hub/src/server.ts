import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { applyOps, type Operation } from '@better-canvas/core'
import { createBoard, listBoards, readBoard, writeBoard } from './boards.ts'
import { readNote, writeVersioned } from './storage.ts'
import { createReference, getSelection, readReference, saveSelection } from './selection.ts'
import { previewSnapshot, previewFile } from './preview.ts'
import { getActiveBoard, setActiveBoard } from './state.ts'
import { startServe, type RunningServer } from './serve.ts'

const UI = 'ui://better-canvas/viewer.html'
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
const write = { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
const modelOnly = { ui: { visibility: ['model'] } }
const both = { ui: { visibility: ['app', 'model'] } }
const selectionSchema = {
  sessionId: z.string().min(1).max(100), board: z.string(),
  nodeIds: z.array(z.string()).max(1000), edgeIds: z.array(z.string()).max(1000),
  revision: z.string().min(1),
}
const record = z.record(z.string(), z.unknown())
const opSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('update_node'), id: z.string(), patch: record }),
  z.object({ op: z.literal('add_node'), node: record }),
  z.object({ op: z.literal('delete_node'), id: z.string() }),
  z.object({ op: z.literal('update_edge'), id: z.string(), patch: record }),
  z.object({ op: z.literal('add_edge'), edge: record }),
  z.object({ op: z.literal('delete_edge'), id: z.string() }),
])

export function createHubServer(initialRoot = '', webDist?: string) {
  const server = new McpServer({ name: 'better-canvas', version: '0.3.0' })
  let root = initialRoot
  let preview: RunningServer | undefined
  function requireRoot() { if (!root) throw new Error('First use open_vault with the folder explicitly chosen by the user.'); return root }
  function result(value: Record<string, unknown>) { return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value } }
  async function run(fn: () => Promise<Record<string, unknown>>) {
    try { return result(await fn()) }
    catch (e) { return { isError: true, content: [{ type: 'text' as const, text: (e as Error).message }] } }
  }

  server.registerResource('canvas-viewer', UI, { mimeType: 'text/html;profile=mcp-app' }, async () => ({
    contents: [{ uri: UI, mimeType: 'text/html;profile=mcp-app',
      text: await readFile(path.join(webDist ?? '', 'widget.html'), 'utf8'),
      _meta: { ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [] } } },
    }],
  }))
  server.registerTool('open_canvas', {
    title: 'Open Canvas', description: 'Open the read-only Canvas panel in this conversation. Select cards and send a request to this same chat. No separate AI is started.',
    inputSchema: { board: z.string().optional() }, annotations: readOnly,
    _meta: { ui: { resourceUri: UI }, 'openai/ui': { entrypoints: [{ type: 'thread' }] } },
  }, ({ board }) => run(async () => root ? await previewSnapshot(root, board) : { needsVault: true }))

  server.registerTool('open_vault', {
    title: 'Open a vault', description: 'Choose the local folder explicitly provided by the user. Do not scan other folders.',
    inputSchema: { path: z.string() }, annotations: readOnly, _meta: modelOnly,
  }, ({ path: selected }) => run(async () => {
    const next = await realpath(selected)
    if (!(await stat(next)).isDirectory()) throw new Error('Vault must be a directory.')
    if (next !== root) { await preview?.close(); preview = undefined }
    root = next
    return { vault: root, boards: await listBoards(root) }
  }))
  server.registerTool('start_preview', {
    title: 'Start browser preview', description: 'Start a local read-only browser preview. A normal browser cannot send to the current chat; use open_canvas in an MCP Apps host for the integrated composer.',
    inputSchema: { port: z.number().int().min(0).max(65535).optional() }, annotations: readOnly, _meta: modelOnly,
  }, ({ port }) => run(async () => {
    requireRoot(); preview ??= await startServe(root, { port: port ?? 0, webDist })
    return { url: 'http://127.0.0.1:' + preview.port + '/', mode: 'read-only', chatConnected: false }
  }))
  server.registerTool('get_preview', {
    description: 'Read the current preview snapshot. Safe for the read-only panel to refresh.',
    inputSchema: { board: z.string().optional() }, annotations: readOnly, _meta: both,
  }, ({ board }) => run(async () => previewSnapshot(requireRoot(), board)))
  server.registerTool('list_boards', {
    description: 'List Canvas files inside the chosen vault.', inputSchema: {}, annotations: readOnly, _meta: both,
  }, () => run(async () => ({ boards: await listBoards(requireRoot()) })))
  server.registerTool('read_board', {
    description: 'Read exact card IDs, geometry, unknown properties and the current revision.',
    inputSchema: { board: z.string() }, annotations: readOnly, _meta: both,
  }, ({ board }) => run(async () => ({ board, ...await readBoard(requireRoot(), board) })))
  server.registerTool('set_active_board', {
    description: 'Choose the initial board for a newly opened preview; does not edit the Canvas.',
    inputSchema: { board: z.string() }, annotations: readOnly, _meta: modelOnly,
  }, ({ board }) => run(async () => { await readBoard(requireRoot(), board); await setActiveBoard(root, board); return { board } }))
  server.registerTool('get_active_board', {
    description: 'Read the default preview board.', inputSchema: {}, annotations: readOnly, _meta: modelOnly,
  }, () => run(async () => ({ board: await getActiveBoard(requireRoot()) })))
  server.registerTool('preview_file', {
    description: 'Read a linked note excerpt or a local raster image for the preview.',
    inputSchema: { path: z.string(), subpath: z.string().optional() }, annotations: readOnly, _meta: both,
  }, ({ path: rel, subpath }) => run(async () => previewFile(requireRoot(), rel, subpath)))
  server.registerTool('save_selection', {
    description: 'Save selected IDs as temporary view metadata. Does not edit any vault content.',
    inputSchema: selectionSchema, annotations: readOnly, _meta: both,
  }, input => run(async () => ({ selection: await saveSelection(requireRoot(), input) })))
  server.registerTool('create_reference', {
    description: 'Capture an immutable reference to selected cards before sending a chat request. Reject stale revisions.',
    inputSchema: selectionSchema, annotations: readOnly, _meta: both,
  }, input => run(async () => createReference(requireRoot(), input)))
  server.registerTool('get_selection', {
    description: 'Read exact selected IDs. If multiple previews are open, specify a sessionId.',
    inputSchema: { sessionId: z.string().optional() }, annotations: readOnly, _meta: modelOnly,
  }, ({ sessionId }) => run(async () => getSelection(requireRoot(), sessionId)))
  server.registerTool('read_reference', {
    description: 'Resolve a chat reference: original snapshot and current cards. If stale, re-read before editing.',
    inputSchema: { id: z.string() }, annotations: readOnly, _meta: modelOnly,
  }, ({ id }) => run(async () => readReference(requireRoot(), id)))
  server.registerTool('read_note', {
    description: 'Read a Markdown/text note, optionally a heading or block. Read the full note before updating it.',
    inputSchema: { path: z.string(), subpath: z.string().optional() }, annotations: readOnly, _meta: both,
  }, ({ path: rel, subpath }) => run(async () => readNote(requireRoot(), rel, subpath)))
  server.registerTool('update_note', {
    description: 'AI-only full note replacement. Preserve unrelated content/frontmatter. Requires a fresh whole-file revision and keeps recovery history.',
    inputSchema: { path: z.string(), text: z.string().max(2 * 1024 * 1024), expectedRevision: z.string().min(1) }, annotations: write, _meta: modelOnly,
  }, ({ path: rel, text, expectedRevision }) => run(async () => {
    await readNote(requireRoot(), rel)
    return { path: rel, revision: await writeVersioned(root, rel, text, expectedRevision) }
  }))
  server.registerTool('apply_ops', {
    description: 'AI-only transactional Canvas changes. Read first and supply expectedRevision. update_node/update_edge use patch objects; null removes optional fields. add_node/add_edge need complete records with exact IDs and coordinates. delete_node also removes attached edges. Preserve unrelated fields and geometry. Never auto-layout unless requested.',
    inputSchema: { board: z.string(), expectedRevision: z.string().min(1), ops: z.array(opSchema).min(1).max(1000) }, annotations: write, _meta: modelOnly,
  }, ({ board, expectedRevision, ops }) => run(async () => {
    const previous = await readBoard(requireRoot(), board)
    const data = applyOps(previous.data, ops as Operation[])
    return { board, revision: await writeBoard(root, board, data, previous.style, expectedRevision), operations: ops.length }
  }))
  server.registerTool('create_board', {
    description: 'Create an empty Canvas only when the user asks.', inputSchema: { board: z.string() }, annotations: write, _meta: modelOnly,
  }, ({ board }) => run(async () => { await createBoard(requireRoot(), board); return { board } }))

  const close = server.close.bind(server)
  server.close = async () => { await preview?.close(); preview = undefined; await close() }
  server.server.onclose = () => { void preview?.close(); preview = undefined }
  return server
}

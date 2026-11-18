import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { applyOps, type Operation } from '@better-canvas/core'
import { createBoard, listBoards, readBoard, writeBoard } from './boards.ts'
import { readNote, writeVersioned } from './storage.ts'
import { createReference, getSelection, readReference, saveSelection } from './selection.ts'
import { previewSnapshot, previewFile, workspacePreview } from './preview.ts'
import { Workspace, workspaceId } from './workspace.ts'
import { getActiveBoard, setActiveBoard } from './state.ts'
import { startServe, type RunningServer } from './serve.ts'

const UI = 'ui://better-canvas/viewer.html'
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
const write = { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
const modelOnly = { ui: { visibility: ['model'] }, 'openai/widgetAccessible': false }
const both = { ui: { visibility: ['app', 'model'] }, 'openai/widgetAccessible': true }
const selectionSchema = {
  workspaceId: z.string().min(1),
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

export function createHubServer(initialRoot: string | Workspace = '', webDist?: string) {
  const server = new McpServer({ name: 'better-canvas', version: '0.4.0' })
  const workspace = typeof initialRoot === 'string' ? new Workspace(initialRoot) : initialRoot
  let preview: RunningServer | undefined
  const requireRoot = () => workspace.requireRoot()
  function result(value: Record<string, unknown>) { return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value } }
  async function run(fn: () => Promise<Record<string, unknown>>) {
    try { return result(await fn()) }
    catch (e) { return { isError: true, content: [{ type: 'text' as const, text: (e as Error).message }] } }
  }

  server.registerResource('canvas-viewer', UI, { mimeType: 'text/html;profile=mcp-app' }, async () => ({
    contents: [{ uri: UI, mimeType: 'text/html;profile=mcp-app',
      text: await readFile(path.join(webDist ?? '', 'widget.html'), 'utf8'),
      _meta: {
        ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [] } },
        'openai/ui': { availableDisplayModes: ['fullscreen'], preferredDisplayMode: 'fullscreen' },
      },
    }],
  }))
  server.registerTool('open_canvas', {
    title: 'Better Canvas', description: 'Open the read-only Canvas panel in this conversation. Select cards and send a request to this same chat. No separate AI is started.',
    inputSchema: {
      board: z.string().optional(),
      file: z.object({ name: z.string(), resourceUri: z.string() }).optional(),
    }, annotations: readOnly,
    _meta: {
      ui: { resourceUri: UI },
      'openai/outputTemplate': UI,
      'openai/ui': { entrypoints: [{ type: 'thread' }, { type: 'file', extensions: ['.canvas'] }] },
    },
  }, ({ board, file }) => run(async () => file ? { needsOpenedFile: true } : workspacePreview(workspace, board)))

  server.registerTool('get_opened_canvas', {
    description: 'Resolve a Canvas opened through the host file-viewer entrypoint. The host supplies its path in MCP metadata. Never infer a path from an opaque resource URI or a filename.',
    inputSchema: {}, annotations: readOnly, _meta: { ...both, ui: { visibility: ['app'] } },
  }, (_input, extra) => run(async () => {
    if (!workspace.root) return { ...workspace.info(), needsVault: true, boards: [] }
    const root = requireRoot()
    const resource = extra._meta?.['openai/resource'] as { path?: unknown } | undefined
    if (typeof resource?.path !== 'string' || !path.isAbsolute(resource.path)) throw new Error('Open a Canvas from the host file viewer to use this entrypoint.')
    const relative = path.relative(await realpath(root), await realpath(resource.path))
    if (path.extname(relative).toLowerCase() !== '.canvas') throw new Error('The opened resource must be a Canvas file.')
    // previewSnapshot/readBoard apply the same vault jail as every other read.
    return previewSnapshot(root, relative)
  }))

  server.registerTool('open_vault', {
    title: 'Open a directory', description: 'Choose and remember the local working directory explicitly provided by the user. An Obsidian vault is optional. Do not scan other folders.',
    inputSchema: { path: z.string() }, annotations: readOnly, _meta: modelOnly,
  }, ({ path: selected }) => run(async () => {
    await workspace.select(selected)
    return workspacePreview(workspace)
  }))
  server.registerTool('set_directory', {
    title: 'Choose working directory', description: 'Remember the directory entered by the user in Settings. Changes the preview scope only; never edits Canvas content.',
    inputSchema: { path: z.string(), workspaceId: z.string().min(1) }, annotations: readOnly, _meta: both,
  }, ({ path: selected, workspaceId }) => run(async () => {
    await workspace.select(selected, workspaceId)
    return workspacePreview(workspace)
  }))
  server.registerTool('start_preview', {
    title: 'Start browser preview', description: 'Start a local read-only browser preview. A normal browser cannot send to the current chat; use open_canvas in an MCP Apps host for the integrated composer.',
    inputSchema: { port: z.number().int().min(0).max(65535).optional() }, annotations: readOnly, _meta: modelOnly,
  }, ({ port }) => run(async () => {
    preview ??= await startServe(workspace, { port: port ?? 0, webDist })
    return { url: 'http://127.0.0.1:' + preview.port + '/', mode: 'read-only', chatConnected: false }
  }))
  server.registerTool('get_preview', {
    description: 'Read the current preview snapshot. Safe for the read-only panel to refresh.',
    inputSchema: { board: z.string().optional(), workspaceId: z.string().optional() }, annotations: readOnly, _meta: both,
  }, ({ board, workspaceId }) => run(async () => workspacePreview(workspace, board, workspaceId)))
  server.registerTool('list_boards', {
    description: 'List Canvas files recursively inside the chosen directory.', inputSchema: {}, annotations: readOnly, _meta: both,
  }, () => run(async () => { const root = requireRoot(); return { workspaceId: workspaceId(root), boards: await listBoards(root) } }))
  server.registerTool('read_board', {
    description: 'Read exact card IDs, geometry, unknown properties, workspaceId and current revision. Supply both workspaceId and expectedRevision when editing.',
    inputSchema: { board: z.string() }, annotations: readOnly, _meta: both,
  }, ({ board }) => run(async () => { const root = requireRoot(); return { workspaceId: workspaceId(root), board, ...await readBoard(root, board) } }))
  server.registerTool('set_active_board', {
    description: 'Choose the initial board for a newly opened preview; does not edit the Canvas.',
    inputSchema: { board: z.string(), workspaceId: z.string().min(1) }, annotations: readOnly, _meta: modelOnly,
  }, ({ board, workspaceId }) => run(() => workspace.scoped(workspaceId, async root => { await readBoard(root, board); await setActiveBoard(root, board); return { board, workspaceId } })))
  server.registerTool('get_active_board', {
    description: 'Read the default preview board.', inputSchema: {}, annotations: readOnly, _meta: modelOnly,
  }, () => run(async () => ({ board: await getActiveBoard(requireRoot()) })))
  server.registerTool('preview_file', {
    description: 'Read a linked note excerpt or a local raster image for the preview.',
    inputSchema: { path: z.string(), subpath: z.string().optional(), workspaceId: z.string().min(1) }, annotations: readOnly, _meta: both,
  }, ({ path: rel, subpath, workspaceId }) => run(async () => { workspace.assertScope(workspaceId); return previewFile(requireRoot(), rel, subpath) }))
  server.registerTool('save_selection', {
    description: 'Save selected IDs as temporary view metadata. Does not edit any vault content.',
    inputSchema: selectionSchema, annotations: readOnly, _meta: both,
  }, input => run(() => workspace.scoped(input.workspaceId, async root => ({ workspaceId: input.workspaceId, selection: await saveSelection(root, input) }))))
  server.registerTool('create_reference', {
    description: 'Capture an immutable reference to selected cards before sending a chat request. Reject stale revisions.',
    inputSchema: selectionSchema, annotations: readOnly, _meta: both,
  }, input => run(() => workspace.scoped(input.workspaceId, async root => ({ ...await createReference(root, input), workspaceId: input.workspaceId }))))
  server.registerTool('get_selection', {
    description: 'Read exact selected IDs. If multiple previews are open, specify a sessionId.',
    inputSchema: { sessionId: z.string().optional() }, annotations: readOnly, _meta: modelOnly,
  }, ({ sessionId }) => run(async () => { const root = requireRoot(); return { ...await getSelection(root, sessionId), workspaceId: workspaceId(root) } }))
  server.registerTool('read_reference', {
    description: 'Resolve a chat reference: original snapshot and current cards. If stale, re-read before editing.',
    inputSchema: { id: z.string(), workspaceId: z.string().optional() }, annotations: readOnly, _meta: modelOnly,
  }, ({ id, workspaceId: expected }) => run(async () => {
    if (expected) workspace.assertScope(expected)
    const root = requireRoot()
    return { ...await readReference(root, id), workspaceId: workspaceId(root) }
  }))
  server.registerTool('read_note', {
    description: 'Read a Markdown/text note, optionally a heading or block. Read the full note before updating it.',
    inputSchema: { path: z.string(), subpath: z.string().optional() }, annotations: readOnly, _meta: both,
  }, ({ path: rel, subpath }) => run(async () => { const root = requireRoot(); return { ...await readNote(root, rel, subpath), workspaceId: workspaceId(root) } }))
  server.registerTool('update_note', {
    description: 'AI-only full note replacement. Preserve unrelated content/frontmatter. Requires a fresh whole-file revision and keeps recovery history.',
    inputSchema: { path: z.string(), text: z.string().max(2 * 1024 * 1024), expectedRevision: z.string().min(1), workspaceId: z.string().min(1) }, annotations: write, _meta: modelOnly,
  }, ({ path: rel, text, expectedRevision, workspaceId }) => run(() => workspace.scoped(workspaceId, async root => {
    await readNote(root, rel)
    return { path: rel, revision: await writeVersioned(root, rel, text, expectedRevision) }
  })))
  server.registerTool('apply_ops', {
    description: 'AI-only transactional Canvas changes. Read first and supply workspaceId and expectedRevision. update_node/update_edge use patch objects; null removes optional fields. add_node/add_edge need complete records with exact IDs and coordinates. delete_node also removes attached edges. Preserve unrelated fields and geometry. Never auto-layout unless requested.',
    inputSchema: { board: z.string(), workspaceId: z.string().min(1), expectedRevision: z.string().min(1), ops: z.array(opSchema).min(1).max(1000) }, annotations: write, _meta: modelOnly,
  }, ({ board, workspaceId, expectedRevision, ops }) => run(() => workspace.scoped(workspaceId, async root => {
    const previous = await readBoard(root, board)
    const data = applyOps(previous.data, ops as Operation[])
    return { board, revision: await writeBoard(root, board, data, previous.style, expectedRevision), operations: ops.length }
  })))
  server.registerTool('create_board', {
    description: 'Create an empty Canvas only when the user asks. Supply workspaceId from get_preview.', inputSchema: { board: z.string(), workspaceId: z.string().min(1) }, annotations: write, _meta: modelOnly,
  }, ({ board, workspaceId }) => run(() => workspace.scoped(workspaceId, async root => { await createBoard(root, board); return { board } })))

  const close = server.close.bind(server)
  server.close = async () => { await preview?.close(); preview = undefined; await close() }
  server.server.onclose = () => { void preview?.close(); preview = undefined }
  return server
}

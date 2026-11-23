import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { MissingTargetsError, WriteIssueError, type Operation } from '@better-canvas/core'
import { createBoard, listBoards, readBoard } from './boards.ts'
import { BoardEdits } from './board-edits.ts'
import { PanelEvents } from './panel-events.ts'
import { readForWrite, readNote, writeVersioned } from './storage.ts'
import { checkTargets, createReference, getSelection, loadReference, readReference, saveSelection } from './selection.ts'
import { previewFile, workspacePreview } from './preview.ts'
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
  const server = new McpServer({ name: 'better-canvas', version: '0.4.1' })
  const workspace = typeof initialRoot === 'string' ? new Workspace(initialRoot) : initialRoot
  const edits = new BoardEdits()
  const events = new PanelEvents(workspace)
  let preview: RunningServer | undefined
  const requireRoot = () => workspace.requireRoot()
  function result(value: Record<string, unknown>) { return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value } }
  async function run(fn: () => Promise<Record<string, unknown>>) {
    try { return result(await fn()) }
    catch (e) { return { isError: true, ...(e instanceof WriteIssueError ? { structuredContent: { issue: e.issue } } : {}), content: [{ type: 'text' as const, text: (e as Error).message }] } }
  }
  async function snapshot(board?: string, expectedWorkspace?: string) {
    const cursor = events.start()
    const value = board ? await withTargets(board, undefined, () => workspacePreview(workspace, board, expectedWorkspace), false)
      : await workspacePreview(workspace, board, expectedWorkspace)
    if ('data' in value && value.board && value.revision && value.data)
      edits.remember(value.directory, value.board, value.revision, value.data)
    return { ...value, cursor }
  }
  async function withTargets<T>(board: string, sessionId: string | undefined, task: () => Promise<T>, notify = true) {
    try { return await task() } catch (e) {
      const missing = e instanceof MissingTargetsError
      if (!missing && (e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      const error = new WriteIssueError({ code: missing ? 'missing_targets' : 'missing_file', path: board,
        nodeIds: missing ? e.nodeIds : [], edgeIds: missing ? e.edgeIds : [] })
      if (notify) await events.warn(error.issue, sessionId)
      throw error
    }
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
  }, ({ board, file }) => run(async () => file ? { needsOpenedFile: true } : snapshot(board)))

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
    return snapshot(relative)
  }))

  server.registerTool('open_vault', {
    title: 'Open a directory', description: 'Choose and remember the local working directory explicitly provided by the user. An Obsidian vault is optional. Do not scan other folders.',
    inputSchema: { path: z.string() }, annotations: readOnly, _meta: modelOnly,
  }, ({ path: selected }) => run(async () => {
    await workspace.select(selected)
    return snapshot()
  }))
  server.registerTool('set_directory', {
    title: 'Choose working directory', description: 'Remember the directory entered by the user in Settings. Changes the preview scope only; never edits Canvas content.',
    inputSchema: { path: z.string(), workspaceId: z.string().min(1) }, annotations: readOnly, _meta: both,
  }, ({ path: selected, workspaceId }) => run(async () => {
    await workspace.select(selected, workspaceId)
    return snapshot()
  }))
  server.registerTool('start_preview', {
    title: 'Start browser preview', description: 'Start a local read-only browser preview. A normal browser cannot send to the current chat; use open_canvas in an MCP Apps host for the integrated composer.',
    inputSchema: { port: z.number().int().min(0).max(65535).optional() }, annotations: readOnly, _meta: modelOnly,
  }, ({ port }) => run(async () => {
    preview ??= await startServe(workspace, { port: port ?? 0, webDist, events })
    return { url: 'http://127.0.0.1:' + preview.port + '/', mode: 'read-only', chatConnected: false }
  }))
  server.registerTool('get_preview', {
    description: 'Read the current preview snapshot. Safe for the read-only panel to refresh.',
    inputSchema: { board: z.string().optional(), workspaceId: z.string().optional() }, annotations: readOnly, _meta: both,
  }, ({ board, workspaceId }) => run(async () => snapshot(board, workspaceId)))
  server.registerTool('wait_for_changes', {
    description: 'Wait for a filesystem change or write warning. Idle waits only use an in-memory cursor.',
    inputSchema: { cursor: z.string().max(150), workspaceId: z.string(), sessionId: z.string().max(100) },
    annotations: readOnly, _meta: { ...both, ui: { visibility: ['app'] } },
  }, ({ cursor, workspaceId, sessionId }, extra) => run(async () => {
    events.start()
    if (workspaceId !== workspace.id) return { cursor: events.cursor, changes: [{ type: 'directory_changed' }] }
    events.present(sessionId, Date.now() + 90_000)
    const batch = await events.wait(cursor, extra.signal)
    if (workspaceId !== workspace.id) return { cursor: events.cursor, changes: [{ type: 'directory_changed' }] }
    return { ...batch, changes: batch.changes.filter(c => c.type !== 'write_warning' || !c.sessionId || c.sessionId === sessionId) }
  }))
  server.registerTool('list_boards', {
    description: 'List Canvas files recursively inside the chosen directory.', inputSchema: {}, annotations: readOnly, _meta: both,
  }, () => run(async () => { const root = requireRoot(); return { workspaceId: workspaceId(root), boards: await listBoards(root) } }))
  server.registerTool('read_board', {
    description: 'Read exact card IDs, geometry, unknown properties, workspaceId and current revision. Supply both workspaceId and expectedRevision when editing.',
    inputSchema: { board: z.string() }, annotations: readOnly, _meta: both,
  }, ({ board }) => run(async () => {
    const root = requireRoot(), current = await readBoard(root, board)
    edits.remember(root, board, current.revision, current.data)
    return { workspaceId: workspaceId(root), board, ...current }
  }))
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
    description: 'Capture the selected IDs in the latest saved board before sending. Return a warning if any disappeared.',
    inputSchema: selectionSchema, annotations: readOnly, _meta: both,
  }, input => run(() => workspace.scoped(input.workspaceId, () => withTargets(input.board, input.sessionId,
    async () => ({ ...await createReference(requireRoot(), input), workspaceId: input.workspaceId }), false))))
  server.registerTool('get_selection', {
    description: 'Read exact selected IDs. If multiple previews are open, specify a sessionId.',
    inputSchema: { sessionId: z.string().optional() }, annotations: readOnly, _meta: modelOnly,
  }, ({ sessionId }) => run(async () => { const root = requireRoot(); return { ...await getSelection(root, sessionId, id => events.isOpen(id)), workspaceId: workspaceId(root) } }))
  server.registerTool('read_reference', {
    description: 'Resolve a chat reference: original snapshot and current cards. If stale, re-read before editing.',
    inputSchema: { id: z.string(), workspaceId: z.string().optional() }, annotations: readOnly, _meta: modelOnly,
  }, ({ id, workspaceId: expected }) => run(async () => {
    if (expected) workspace.assertScope(expected)
    const root = requireRoot()
    const ref = await loadReference(root, id)
    return withTargets(ref.board, ref.sessionId, async () => ({ ...await readReference(root, id, ref), workspaceId: workspaceId(root) }))
  }))
  server.registerTool('read_note', {
    description: 'Read a Markdown/text note, optionally a heading or block. Read the full note before updating it.',
    inputSchema: { path: z.string(), subpath: z.string().optional() }, annotations: readOnly, _meta: both,
  }, ({ path: rel, subpath }) => run(async () => { const root = requireRoot(); return { ...await readNote(root, rel, subpath), workspaceId: workspaceId(root) } }))
  server.registerTool('update_note', {
    description: 'AI-only full note replacement. Preserve unrelated content/frontmatter. Requires a fresh whole-file revision and keeps recovery history.',
    inputSchema: { path: z.string(), text: z.string().max(2 * 1024 * 1024), expectedRevision: z.string().min(1), workspaceId: z.string().min(1) }, annotations: write, _meta: modelOnly,
  }, ({ path: rel, text, expectedRevision, workspaceId }) => run(() => workspace.scoped(workspaceId, async root => {
    return withTargets(rel, undefined, async () => {
      await readForWrite(() => readNote(root, rel))
      const revision = await writeVersioned(root, rel, text, expectedRevision)
      events.saved(rel)
      return { path: rel, revision }
    })
  })))
  server.registerTool('apply_ops', {
    description: 'Apply this batch on the current saved board. Pass workspaceId, the last read revision and referenceId for a card request. Independent changes rebase automatically. On a field conflict read_board, adapt the patch to the new text, and retry. A missing target stops the batch and alerts its panel. Node/edge updates take patch objects; null removes optional fields. Adds require complete IDs and geometry. Keep unrelated fields and geometry.',
    inputSchema: { board: z.string(), workspaceId: z.string().min(1), expectedRevision: z.string().min(1), referenceId: z.string().optional(), ops: z.array(opSchema).min(1).max(1000) }, annotations: write, _meta: modelOnly,
  }, ({ board, workspaceId, expectedRevision, referenceId, ops }) => run(() => workspace.scoped(workspaceId, async root => {
    const ref = referenceId ? await loadReference(root, referenceId) : undefined
    if (ref && ref.board !== board) throw new Error('The reference belongs to a different canvas.')
    return withTargets(board, ref?.sessionId, async () => {
      const saved = await edits.apply(root, board, expectedRevision, ops as Operation[], ref ? data => checkTargets(data, ref) : undefined)
      events.saved(board)
      return saved
    })
  })))
  server.registerTool('create_board', {
    description: 'Create an empty Canvas only when the user asks. Supply workspaceId from get_preview.', inputSchema: { board: z.string(), workspaceId: z.string().min(1) }, annotations: write, _meta: modelOnly,
  }, ({ board, workspaceId }) => run(() => workspace.scoped(workspaceId, async root => { await createBoard(root, board); events.saved(board); return { board } })))

  const close = server.close.bind(server)
  server.close = async () => { events.close(); await preview?.close(); preview = undefined; await close() }
  server.server.onclose = () => { events.close(); void preview?.close(); preview = undefined }
  return server
}

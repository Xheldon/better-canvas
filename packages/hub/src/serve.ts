import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { WebSocketServer } from 'ws'
import { MissingTargetsError, WriteIssueError } from '@better-canvas/core'
import { listBoards, readBoard } from './boards.ts'
import { createReference, saveSelection, type Selection } from './selection.ts'
import { previewFile, workspacePreview } from './preview.ts'
import { PanelEvents } from './panel-events.ts'
import { Workspace } from './workspace.ts'

export interface ServeOptions { port?: number; webDist?: string; events?: PanelEvents }
export interface RunningServer { port: number; close(): Promise<void> }
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}
async function body(req: IncomingMessage) {
  let size = 0
  const chunks: Buffer[] = []
  for await (const part of req) {
    size += part.length
    if (size > 128 * 1024) throw new Error('Request too large.')
    chunks.push(Buffer.from(part))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Loopback preview. No route can write, upload, rename, delete or edit vault content. */
export async function startServe(initialRoot: string | Workspace, options: ServeOptions = {}): Promise<RunningServer> {
  const workspace = typeof initialRoot === 'string' ? new Workspace(initialRoot) : initialRoot
  const events = options.events ?? new PanelEvents(workspace)
  events.start()
  async function snapshot(board?: string, scope?: string) {
    const cursor = events.cursor
    try { return { ...await workspacePreview(workspace, board, scope), cursor } }
    catch (e) {
      if (board && (e as NodeJS.ErrnoException).code === 'ENOENT')
        throw new WriteIssueError({ code: 'missing_file', path: board, nodeIds: [], edgeIds: [] })
      throw e
    }
  }
  let port = 0
  function permitted(req: IncomingMessage) {
    const host = req.headers.host
    const origin = req.headers.origin
    return (host === '127.0.0.1:' + port || host === 'localhost:' + port)
      && (!origin || origin === 'http://' + host)
      && !['cross-site'].includes(req.headers['sec-fetch-site'] as string)
  }
  const server = createServer((req, res) => {
    void (async () => {
      res.setHeader('x-content-type-options', 'nosniff')
      res.setHeader('referrer-policy', 'no-referrer')
      if (!permitted(req)) return json(res, 403, { error: 'Only same-origin local preview requests are accepted.' })
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const route = url.pathname
      if (route.startsWith('/api/')) {
        if (req.method === 'POST' && ['/api/selection', '/api/reference', '/api/directory'].includes(route)) {
          if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Expected JSON.' })
          const input = await body(req) as Omit<Selection, 'updatedAt'> & { workspaceId: string; path: string }
          if (typeof input.workspaceId !== 'string') throw new Error('Refresh the preview before continuing.')
          // Directory preferences and selection metadata never edit Canvas content.
          if (route === '/api/directory') {
            await workspace.select(input.path, input.workspaceId)
            return json(res, 200, await snapshot())
          }
          const value = await workspace.scoped(input.workspaceId, async root => {
            if (route === '/api/selection') return saveSelection(root, input)
            try { return await createReference(root, input) } catch (e) {
              if (e instanceof MissingTargetsError || (e as NodeJS.ErrnoException).code === 'ENOENT')
                throw new WriteIssueError({ path: input.board, code: e instanceof MissingTargetsError ? 'missing_targets' : 'missing_file',
                  nodeIds: e instanceof MissingTargetsError ? e.nodeIds : [], edgeIds: e instanceof MissingTargetsError ? e.edgeIds : [] })
              throw e
            }
          })
          return json(res, 200, { ...value, workspaceId: input.workspaceId })
        }
        if (req.method !== 'GET') return json(res, 405, { error: 'Read-only preview. Content changes are available only through MCP.' })
        if (route === '/api/preview') return json(res, 200, await snapshot(url.searchParams.get('board') ?? undefined, url.searchParams.get('workspaceId') ?? undefined))
        const root = workspace.requireRoot()
        if (route === '/api/boards') return json(res, 200, await listBoards(root))
        if (route === '/api/board') return json(res, 200, { workspaceId: workspace.id, ...await readBoard(root, url.searchParams.get('path') ?? '') })
        if (route === '/api/file') {
          workspace.assertScope(url.searchParams.get('workspaceId') ?? '')
          return json(res, 200, await previewFile(root, url.searchParams.get('path') ?? '', url.searchParams.get('subpath') ?? undefined))
        }
        return json(res, 404, { error: 'Unknown route.' })
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Read-only preview.' })
      if (!options.webDist) return json(res, 404, { error: 'Build the web preview first.' })
      const relative = decodeURIComponent(route === '/' ? '/index.html' : route)
      const file = path.resolve(options.webDist, '.' + relative)
      if (!file.startsWith(path.resolve(options.webDist) + path.sep) || relative.split('/').some(s => s.startsWith('.'))) return json(res, 403, { error: 'Invalid path.' })
      const bytes = await readFile(file)
      res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:" + port + " ws://localhost:" + port + "; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'")
      res.writeHead(200, { 'content-type': mime[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' })
      res.end(req.method === 'HEAD' ? undefined : bytes)
    })().catch((error: unknown) => {
      const e = error as Error & { status?: number; code?: string }
      json(res, e.status ?? (e.code === 'ENOENT' ? 404 : 400), { error: e.message, ...(e instanceof WriteIssueError ? { issue: e.issue } : {}) })
    })
  })
  const sockets = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!permitted(req) || url.pathname !== '/ws') { socket.destroy(); return }
    sockets.handleUpgrade(req, socket, head, ws => {
      let cursor = url.searchParams.get('cursor') || events.cursor
      const scope = url.searchParams.get('workspaceId'), session = url.searchParams.get('sessionId')
      if (session) events.present(session, Infinity)
      const send = () => {
        const batch = events.since(cursor)
        cursor = batch.cursor
        if (scope && scope !== workspace.id) {
          ws.send(JSON.stringify({ type: 'directory_changed', cursor }))
          return
        }
        const changes = batch.changes.filter(c => c.type !== 'write_warning' || !c.sessionId || c.sessionId === session)
        if (scope && changes.length) ws.send(JSON.stringify({ cursor, changes }))
        if (!scope) for (const change of changes) {
          // The original /ws API is also used by standalone clients.
          if (change.type !== 'write_warning') ws.send(JSON.stringify('path' in change ? { type: change.type, path: change.path } : change))
        }
      }
      const unsubscribe = events.onChange(send)
      ws.on('close', () => { unsubscribe(); if (session) events.present(session, 0) })
      send()
    })
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(options.port ?? 0, '127.0.0.1', () => { port = (server.address() as { port: number }).port; resolve() })
    })
  } catch (e) { if (!options.events) events.close(); sockets.close(); throw e }
  return { port, async close() {
    if (!options.events) events.close()
    for (const client of sockets.clients) client.terminate()
    sockets.close()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()))
  } }
}

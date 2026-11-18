import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import { listBoards, readBoard } from './boards.ts'
import { createReference, saveSelection, type Selection } from './selection.ts'
import { previewFile, workspacePreview } from './preview.ts'
import { watchRoot } from './watch.ts'
import { Workspace } from './workspace.ts'

export interface ServeOptions { port?: number; webDist?: string }
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
            return json(res, 200, await workspacePreview(workspace))
          }
          const value = await workspace.scoped(input.workspaceId, async root => route === '/api/selection' ? await saveSelection(root, input) : await createReference(root, input))
          return json(res, 200, { ...value, workspaceId: input.workspaceId })
        }
        if (req.method !== 'GET') return json(res, 405, { error: 'Read-only preview. Content changes are available only through MCP.' })
        if (route === '/api/preview') return json(res, 200, await workspacePreview(workspace, url.searchParams.get('board') ?? undefined, url.searchParams.get('workspaceId') ?? undefined))
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
      json(res, e.status ?? (e.code === 'ENOENT' ? 404 : 400), { error: e.message })
    })
  })
  const sockets = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    if (!permitted(req) || req.url !== '/ws') { socket.destroy(); return }
    sockets.handleUpgrade(req, socket, head, ws => sockets.emit('connection', ws, req))
  })
  const broadcast = (value: object) => {
    const message = JSON.stringify(value)
    for (const socket of sockets.clients) if (socket.readyState === WebSocket.OPEN) socket.send(message)
  }
  let watcher: ReturnType<typeof watchRoot> | undefined
  function attachWatcher() {
    watcher?.close(); watcher = undefined
    if (workspace.root) {
      // Polling remains available if the platform cannot attach a watcher.
      try { watcher = watchRoot(workspace.root, signal => broadcast({ type: signal.type === 'canvas' ? 'board_changed' : 'file_changed', path: signal.board })) }
      catch { /* The preview also polls for external changes. */ }
    }
  }
  attachWatcher()
  const unsubscribe = workspace.subscribe(() => { attachWatcher(); broadcast({ type: 'directory_changed' }) })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(options.port ?? 0, '127.0.0.1', () => { port = (server.address() as { port: number }).port; resolve() })
    })
  } catch (e) { unsubscribe(); watcher?.close(); sockets.close(); throw e }
  return { port, async close() {
    unsubscribe(); watcher?.close()
    for (const client of sockets.clients) client.terminate()
    sockets.close()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()))
  } }
}

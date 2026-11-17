import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import { listBoards, readBoard } from './boards.ts'
import { createReference, saveSelection, type Selection } from './selection.ts'
import { previewFile, previewSnapshot } from './preview.ts'
import { watchRoot } from './watch.ts'

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
export async function startServe(root: string, options: ServeOptions = {}): Promise<RunningServer> {
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
        if (req.method === 'POST' && ['/api/selection', '/api/reference'].includes(route)) {
          if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Expected JSON.' })
          const input = await body(req) as Omit<Selection, 'updatedAt'>
          // Only view metadata is persisted; neither endpoint can edit a Canvas.
          return json(res, 200, route === '/api/selection' ? await saveSelection(root, input) : await createReference(root, input))
        }
        if (req.method !== 'GET') return json(res, 405, { error: 'Read-only preview. Content changes are available only through MCP.' })
        if (route === '/api/preview') return json(res, 200, await previewSnapshot(root, url.searchParams.get('board') ?? undefined))
        if (route === '/api/boards') return json(res, 200, await listBoards(root))
        if (route === '/api/board') return json(res, 200, await readBoard(root, url.searchParams.get('path') ?? ''))
        if (route === '/api/file') return json(res, 200, await previewFile(root, url.searchParams.get('path') ?? '', url.searchParams.get('subpath') ?? undefined))
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
  const watcher = watchRoot(root, signal => {
    const message = JSON.stringify({ type: signal.type === 'canvas' ? 'board_changed' : 'file_changed', path: signal.board })
    for (const socket of sockets.clients) if (socket.readyState === WebSocket.OPEN) socket.send(message)
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(options.port ?? 0, '127.0.0.1', () => { port = (server.address() as { port: number }).port; resolve() })
    })
  } catch (e) { watcher.close(); sockets.close(); throw e }
  return { port, async close() {
    watcher.close()
    for (const client of sockets.clients) client.terminate()
    sockets.close()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()))
  } }
}

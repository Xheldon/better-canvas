import type { CanvasData } from '@better-canvas/core'
export interface Snapshot {
  vaultName?: string; needsVault?: boolean; needsOpenedFile?: boolean
  boards: { path: string; nodes: number; edges: number }[]
  board?: string; revision?: string; data?: CanvasData
}
export interface Selection { sessionId: string; board: string; nodeIds: string[]; edgeIds: string[]; revision: string }
export interface Reference { id: string; board: string; nodeIds: string[]; edgeIds: string[]; revision: string; citation: string }
export interface FilePreview { kind: 'note' | 'image' | 'unsupported'; path: string; text?: string; src?: string }
declare global { interface Window { __BETTER_CANVAS_MCP__?: boolean } }

export interface Client {
  mode: 'browser' | 'mcp'
  canSend: boolean
  preview(board?: string): Promise<Snapshot>
  file(path: string, subpath?: string): Promise<FilePreview>
  selection(value: Selection): Promise<unknown>
  reference(value: Selection): Promise<Reference>
  send(reference: Reference, instruction: string): Promise<void>
  subscribe(refresh: () => void): () => void
}
export function messageFor(reference: Reference, instruction: string) {
  return instruction + '\n\nCanvas reference: ' + JSON.stringify({
    referenceId: reference.id, board: reference.board, nodeIds: reference.nodeIds, edgeIds: reference.edgeIds, revision: reference.revision,
  }) + '\nUse Better Canvas read_reference to resolve these cards. Read current content before editing; use apply_ops with the current expectedRevision. Keep unrelated cards and their geometry unchanged unless requested.'
}
async function http<T>(route: string, data?: unknown): Promise<T> {
  const response = await fetch(route, data === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? 'Preview request failed.')
  return value as T
}
export async function connectClient(): Promise<Client> {
  if (!window.__BETTER_CANVAS_MCP__) return {
    mode: 'browser', canSend: false,
    preview: board => http('/api/preview' + (board ? '?board=' + encodeURIComponent(board) : '')),
    file: (path, subpath) => http('/api/file?' + new URLSearchParams({ path, ...(subpath ? { subpath } : {}) })),
    selection: value => http('/api/selection', value),
    reference: value => http('/api/reference', value),
    send: async () => { throw new Error('Open the MCP App panel to send to this chat.') },
    subscribe(refresh) {
      let socket: WebSocket | undefined, retry: ReturnType<typeof setTimeout>, closed = false
      function connect() {
        socket = new WebSocket(location.origin.replace(/^http/, 'ws') + '/ws')
        socket.onopen = refresh
        socket.onmessage = refresh
        socket.onclose = () => { if (!closed) retry = setTimeout(connect, 1500) }
      }
      connect()
      // A missed filesystem notification must not leave a permanently stale view.
      const poll = setInterval(refresh, 6000)
      return () => { closed = true; clearTimeout(retry); clearInterval(poll); socket?.close() }
    },
  }
  const { App: McpApp } = await import('@modelcontextprotocol/ext-apps')
  const app = new McpApp({ name: 'Better Canvas', version: '0.3.1' }, { availableDisplayModes: ['fullscreen'] }, { autoResize: false })
  const listeners = new Set<() => void>()
  let initial: Snapshot | undefined
  let awaitingOpenedFile = false
  app.ontoolinput = params => {
    if (params.arguments?.file) {
      awaitingOpenedFile = true
      for (const listener of listeners) listener()
    }
  }
  app.ontoolresult = result => {
    if (result.structuredContent) initial = result.structuredContent as unknown as Snapshot
    if (initial?.needsOpenedFile) awaitingOpenedFile = true
    for (const listener of listeners) listener()
  }
  await app.connect(undefined, { timeout: 8000 })
  async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const result = await app.callServerTool({ name, arguments: args })
    if (result.isError) throw new Error(result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || 'Tool call failed.')
    return (result.structuredContent ?? JSON.parse((result.content?.find(c => c.type === 'text') as { text: string })?.text ?? '{}')) as T
  }
  return {
    mode: 'mcp', canSend: !!app.getHostCapabilities()?.message?.text,
    preview: async board => {
      if (awaitingOpenedFile) {
        const value = await call<Snapshot>('get_opened_canvas')
        if (value.board) { awaitingOpenedFile = false; initial = undefined }
        return value
      }
      if (initial && !board) { const value = initial; initial = undefined; return value }
      return call('get_preview', board ? { board } : {})
    },
    file: (path, subpath) => call('preview_file', { path, subpath }),
    selection: value => call('save_selection', { ...value }),
    reference: value => call('create_reference', { ...value }),
    async send(reference, instruction) {
      if (!app.getHostCapabilities()?.message?.text) throw new Error('This host does not support sending messages.')
      const result = await app.sendMessage({
        role: 'user', content: [{ type: 'text', text: messageFor(reference, instruction) }],
        ...(app.getHostCapabilities()?.experimental?.['openai/message'] ? {
          _meta: { 'openai/message': { target: 'active', send: true } },
        } : {}),
      }, { timeout: 15000 })
      if (result.isError) throw new Error('The host did not accept the message. Your draft is preserved.')
    },
    subscribe(refresh) {
      listeners.add(refresh)
      const timer = setInterval(() => { if (!document.hidden) refresh() }, 2000)
      return () => { listeners.delete(refresh); clearInterval(timer) }
    },
  }
}

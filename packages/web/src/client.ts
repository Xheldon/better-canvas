import { WriteIssueError, type CanvasData, type ChangeBatch, type PanelChange } from '@better-canvas/core'
export interface Snapshot {
  workspaceId: string; directory?: string; directoryName?: string
  vaultName?: string; needsVault?: boolean; needsOpenedFile?: boolean
  boards: { path: string; nodes: number; edges: number }[]
  board?: string; revision?: string; data?: CanvasData; cursor?: string
}
export interface Selection { workspaceId: string; sessionId: string; board: string; nodeIds: string[]; edgeIds: string[]; revision: string }
export interface Reference { workspaceId: string; id: string; board: string; nodeIds: string[]; edgeIds: string[]; revision: string; citation: string }
export interface FilePreview { kind: 'note' | 'image' | 'unsupported'; path: string; text?: string; src?: string; watchPath?: string }
export type ClientChange = PanelChange | { type: 'opened'; snapshot: Snapshot }
declare global { interface Window { __BETTER_CANVAS_MCP__?: boolean } }

export interface Client {
  mode: 'browser' | 'mcp'
  canSend: boolean
  preview(board?: string, workspaceId?: string): Promise<Snapshot>
  setDirectory(path: string, workspaceId: string): Promise<Snapshot>
  file(path: string, subpath?: string, workspaceId?: string): Promise<FilePreview>
  selection(value: Selection): Promise<unknown>
  reference(value: Selection): Promise<Reference>
  send(reference: Reference, instruction: string): Promise<void>
  subscribe(notify: (change?: ClientChange) => void, scope: { workspaceId: string; cursor?: string; sessionId: string }): () => void
}
export function messageFor(reference: Reference, instruction: string) {
  return instruction + '\n\nCanvas reference: ' + JSON.stringify({
    referenceId: reference.id, workspaceId: reference.workspaceId, board: reference.board, nodeIds: reference.nodeIds, edgeIds: reference.edgeIds, revision: reference.revision,
  }) + '\nResolve these cards with Better Canvas read_reference. Pass referenceId, workspaceId and the latest read_board revision to apply_ops. If a touched field changed, read it again and adapt the requested patch. Stop if a referenced item is missing. Keep unrelated cards and their geometry.'
}
async function http<T>(route: string, data?: unknown): Promise<T> {
  const response = await fetch(route, data === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
  const value = await response.json()
  if (!response.ok) { if (value.issue) throw new WriteIssueError(value.issue); throw new Error(value.error ?? 'Preview request failed.') }
  return value as T
}
export async function connectClient(): Promise<Client> {
  if (!window.__BETTER_CANVAS_MCP__) return {
    mode: 'browser', canSend: false,
    preview: (board, workspaceId) => http('/api/preview?' + new URLSearchParams({ ...(board ? { board } : {}), ...(workspaceId ? { workspaceId } : {}) })),
    setDirectory: (path, workspaceId) => http('/api/directory', { path, workspaceId }),
    file: (path, subpath, workspaceId) => http('/api/file?' + new URLSearchParams({ path, ...(subpath ? { subpath } : {}), ...(workspaceId ? { workspaceId } : {}) })),
    selection: value => http('/api/selection', value),
    reference: value => http('/api/reference', value),
    send: async () => { throw new Error('Open the MCP App panel to send to this chat.') },
    subscribe(notify, scope) {
      let socket: WebSocket | undefined, retry: ReturnType<typeof setTimeout>, closed = false
      let cursor = scope.cursor
      function connect() {
        const query = new URLSearchParams({ workspaceId: scope.workspaceId, sessionId: scope.sessionId, ...(cursor ? { cursor } : {}) })
        socket = new WebSocket(location.origin.replace(/^http/, 'ws') + '/ws?' + query)
        socket.onmessage = event => {
          if (closed) return
          const message = JSON.parse(event.data)
          cursor = message.cursor ?? cursor
          if (Array.isArray(message.changes)) message.changes.forEach(notify)
          else notify(message)
        }
        socket.onclose = () => { if (!closed) retry = setTimeout(connect, 1500) }
      }
      connect()
      return () => { closed = true; clearTimeout(retry); socket?.close() }
    },
  }
  const { App: McpApp } = await import('@modelcontextprotocol/ext-apps')
  const app = new McpApp({ name: 'Better Canvas', version: '0.4.1' }, { availableDisplayModes: ['fullscreen'] }, { autoResize: false })
  let initial: Snapshot | undefined
  let awaitingOpenedFile = false
  let firstLoad = true
  let wakeInitial: (() => void) | undefined
  const entrypoints = new Set<(change?: ClientChange) => void>()
  app.ontoolinput = params => {
    if (params.arguments?.file) {
      awaitingOpenedFile = true
      wakeInitial?.()
    }
  }
  app.ontoolresult = result => {
    if (!result.structuredContent) return
    initial = result.structuredContent as unknown as Snapshot
    if (initial?.needsOpenedFile) awaitingOpenedFile = true
    wakeInitial?.()
    if (entrypoints.size) {
      const opened = initial
      initial = undefined
      for (const notify of entrypoints) notify(opened.needsOpenedFile ? undefined : { type: 'opened', snapshot: opened })
    }
  }
  await app.connect(undefined, { timeout: 8000 })
  async function call<T>(name: string, args: Record<string, unknown> = {}, options?: Parameters<typeof app.callServerTool>[1]): Promise<T> {
    const result = await app.callServerTool({ name, arguments: args }, options)
    if (result.isError) {
      const details = result.structuredContent as { issue?: WriteIssueError['issue'] } | undefined
      if (details?.issue) throw new WriteIssueError(details.issue)
      throw new Error(result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || 'Tool call failed.')
    }
    return (result.structuredContent ?? JSON.parse((result.content?.find(c => c.type === 'text') as { text: string })?.text ?? '{}')) as T
  }
  return {
    mode: 'mcp', canSend: !!app.getHostCapabilities()?.message?.text,
    preview: async (board, workspaceId) => {
      if (firstLoad) {
        firstLoad = false
        // Reuse open_canvas's tool result, including when it arrives just after connect().
        if (!initial && !awaitingOpenedFile) await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 750)
          wakeInitial = () => { clearTimeout(timer); resolve() }
        })
        wakeInitial = undefined
      }
      if (awaitingOpenedFile) {
        const value = await call<Snapshot>('get_opened_canvas')
        if (value.board) { awaitingOpenedFile = false; initial = undefined }
        return value
      }
      if (initial && !board && !workspaceId) { const value = initial; initial = undefined; return value }
      return call('get_preview', { board, workspaceId })
    },
    async setDirectory(path, workspaceId) {
      const value = await call<Snapshot>('set_directory', { path, workspaceId })
      initial = undefined
      // Choosing a directory explicitly leaves the pending host file entrypoint.
      awaitingOpenedFile = false
      return value
    },
    file: (path, subpath, workspaceId) => call('preview_file', { path, subpath, workspaceId }),
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
    subscribe(notify, scope) {
      entrypoints.add(notify)
      if (!scope.cursor) return () => { entrypoints.delete(notify) }
      let cursor = scope.cursor, active = false
      const stop = new AbortController()
      let retry: ReturnType<typeof setTimeout> | undefined
      async function listen() {
        if (active || stop.signal.aborted || document.hidden) return
        active = true
        try {
          while (!stop.signal.aborted && !document.hidden) {
            const batch = await call<ChangeBatch>('wait_for_changes', { ...scope, cursor }, { signal: stop.signal, timeout: 55_000 })
            if (stop.signal.aborted) return
            cursor = batch.cursor
            for (const change of batch.changes) notify(change)
            if (batch.changes.some(e => e.type === 'directory_changed')) return
          }
        } catch {
          if (!stop.signal.aborted) retry = setTimeout(listen, 5000)
        } finally { active = false }
      }
      void listen()
      document.addEventListener('visibilitychange', listen)
      return () => { entrypoints.delete(notify); stop.abort(); clearTimeout(retry); document.removeEventListener('visibilitychange', listen) }
    },
  }
}

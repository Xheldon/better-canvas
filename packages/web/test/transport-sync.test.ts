// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { connectClient } from '../src/client'

const { callTool } = vi.hoisted(() => ({ callTool: vi.fn() }))
const scope = { workspaceId: 'scope', sessionId: 'example', cursor: 'position:0' }
vi.mock('@modelcontextprotocol/ext-apps', () => ({
  App: class {
    ontoolresult?: (value: unknown) => void
    async connect() { this.ontoolresult?.({ structuredContent: { ...scope, board: 'Board.canvas', boards: [], revision: 'opening' } }) }
    getHostCapabilities() { return { message: { text: {} } } }
    callServerTool = callTool
  },
}))
afterEach(() => { delete window.__BETTER_CANVAS_MCP__; vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks() })

it('reuses the MCP opening result and waits without scheduling snapshot or attachment reads', async () => {
  vi.useFakeTimers()
  window.__BETTER_CANVAS_MCP__ = true
  let complete!: (result: unknown) => void
  callTool.mockImplementation(() => new Promise(resolve => { complete = resolve }))
  const client = await connectClient()
  expect((await client.preview()).revision).toBe('opening')
  expect(callTool).not.toHaveBeenCalled()
  const notify = vi.fn(), close = client.subscribe(notify, scope)
  expect(callTool.mock.calls.map(([request]) => request.name)).toEqual(['wait_for_changes'])
  await vi.advanceTimersByTimeAsync(40_000)
  complete({ structuredContent: { cursor: scope.cursor, changes: [] } })
  await vi.advanceTimersByTimeAsync(0)
  expect(notify).not.toHaveBeenCalled()
  expect(callTool.mock.calls.map(([request]) => request.name)).toEqual(['wait_for_changes', 'wait_for_changes'])
  complete({ structuredContent: { cursor: 'position:1', changes: [{ type: 'file_changed', path: 'A.png' }] } })
  await vi.advanceTimersByTimeAsync(0)
  expect(notify).toHaveBeenCalledExactlyOnceWith({ type: 'file_changed', path: 'A.png' })
  close(); complete({ structuredContent: { cursor: 'position:1', changes: [] } })
})

it('opens a browser preview once and resumes the socket cursor after disconnection', async () => {
  vi.useFakeTimers()
  let socket!: { url: string; onclose?(): void; onmessage?(event: {data: string}): void }
  vi.stubGlobal('WebSocket', class {
    url: string
    constructor(url: string) { this.url = url; socket = this }
    close() {}
  })
  const fetcher = vi.fn(async () => ({ ok: true, json: () => ({ ...scope, board: 'Board.canvas', boards: [] }) }))
  vi.stubGlobal('fetch', fetcher)
  const client = await connectClient(), notify = vi.fn()
  await client.preview()
  const close = client.subscribe(notify, scope)
  await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000)
  expect(fetcher).toHaveBeenCalledTimes(1); expect(notify).not.toHaveBeenCalled()
  socket.onmessage?.({ data: JSON.stringify({ cursor: 'position:4', changes: [{ type: 'board_changed', path: 'Board.canvas' }] }) })
  socket.onclose?.()
  await vi.advanceTimersByTimeAsync(1600)
  expect(new URL(socket.url).searchParams.get('cursor')).toBe('position:4')
  expect(fetcher).toHaveBeenCalledTimes(1); expect(notify).toHaveBeenCalledTimes(1)
  close()
})

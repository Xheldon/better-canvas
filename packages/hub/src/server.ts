import { realpath, stat } from 'node:fs/promises'
import { startServe, type RunningServer } from './serve.ts'
import { ConflictError, readNote, revisionOf, writeVersioned } from './storage.ts'
import { getSelection, readReference } from './selection.ts'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  parseCanvas,
  applyOps,
  autoLayout,
  railMemberIds,
  structuralProjection,
  type CanvasData,
  type Op,
} from '@canvai/canvas-kit'
import { createBoard, listBoards, readBoard, readBoardRaw, writeBoard } from './boards.ts'
import { addPinned, getActiveBoard, getPinned, removePinned, setActiveBoard } from './state.ts'
import { appendEvent, readEventsSince, type HubEvent } from './events.ts'
import { appendChat, readChatSince } from './chat.ts'

const dirEnum = z.enum(['right', 'below', 'left', 'above'])

const opSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_node'),
    type: z.enum(['text', 'file', 'link']).optional().describe('default: text'),
    text: z.string().optional().describe('markdown; ```mermaid fences render in clients'),
    file: z.string().optional().describe('repo-relative path, for type=file'),
    url: z.string().optional().describe('for type=link'),
    color: z.string().optional().describe('canvas color: preset "1"-"6" or "#RRGGBB"'),
    width: z.number().optional(),
    height: z.number().optional(),
    anchor: z.string().optional().describe('place next to this node (id/prefix or "$ref")'),
    dir: dirEnum.optional().describe('side of the anchor, default right'),
    in_group: z.string().optional().describe('place inside this group node'),
    ref: z.string().optional().describe('name the node; later ops may reference "$<ref>"'),
  }),
  z.object({
    op: z.literal('add_group'),
    label: z.string(),
    around: z.array(z.string()).optional().describe('existing nodes to wrap'),
    color: z.string().optional(),
    ref: z.string().optional(),
  }),
  z.object({
    op: z.literal('update_node'),
    id: z.string(),
    text: z.string().optional(),
    color: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    file: z.string().optional(),
    url: z.string().optional(),
    label: z.string().optional(),
  }),
  z.object({ op: z.literal('delete_node'), id: z.string() }),
  z.object({
    op: z.literal('connect'),
    from: z.string(),
    to: z.string(),
    label: z.string().optional(),
    color: z.string().optional(),
    arrows: z.enum(['to', 'none', 'from', 'both']).optional().describe('arrowhead placement, default "to"'),
  }),
  z.object({ op: z.literal('disconnect'), from: z.string(), to: z.string() }),
  z.object({
    op: z.literal('move'),
    id: z.string(),
    dx: z.number().optional(),
    dy: z.number().optional(),
    anchor: z.string().optional(),
    dir: dirEnum.optional(),
  }),
  z.object({
    op: z.literal('add_rail'),
    orient: z.enum(['h', 'v']).optional().describe('default h'),
    slots: z.number().optional().describe('default 5; rails also grow on demand when attach fills them'),
    pitch: z.number().optional().describe('slot spacing in px; default 160 (attach "both") / 340 (single side)'),
    attach: z
      .enum(['both', 'above', 'below', 'left', 'right'])
      .optional()
      .describe('which side(s) cards attach on; "both" alternates fishbone-style (default)'),
    label: z.string().optional(),
    anchor: z.string().optional().describe('place near this node (id/prefix or "$ref")'),
    dir: dirEnum.optional().describe('side of the anchor, default below'),
    ref: z.string().optional(),
  }),
  z.object({
    op: z.literal('attach_to_rail'),
    rail: z.string(),
    card: z.string().optional().describe('attach this existing card…'),
    text: z.string().optional().describe('…or create a new text card and attach it'),
    color: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    slot: z
      .number()
      .optional()
      .describe('1-based; occupied slot = insert here (later cards shift); omit for first free slot'),
    ref: z.string().optional(),
  }),
  z.object({ op: z.literal('rail_detach'), rail: z.string(), card: z.string() }),
  z.object({
    op: z.literal('rail_reorder'),
    rail: z.string(),
    card: z.string(),
    slot: z.number().describe('1-based destination (insert semantics)'),
  }),
  z.object({ op: z.literal('extend_rail'), rail: z.string(), add: z.number().optional().describe('default 1') }),
  z.object({ op: z.literal('set_rail'), rail: z.string(), pitch: z.number().describe('re-projects joints and attached cards') }),
  z.object({ op: z.literal('pin'), id: z.string().describe('auto_layout will not move this node') }),
  z.object({ op: z.literal('unpin'), id: z.string() }),
])

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

const text = (s: string): ToolResult => ({ content: [{ type: 'text', text: s }] })
const fail = (e: unknown): ToolResult => ({
  content: [{ type: 'text', text: `error: ${e instanceof Error ? e.message : String(e)}` }],
  isError: true,
})

/**
 * A human dragging one card produces a burst of near-identical events;
 * collapse consecutive runs (same origin/board/first summary word + node)
 * into one line with a ×count — pure token savings for agents.
 */
function coalesceEvents(events: HubEvent[]): { event: HubEvent; count: number }[] {
  const out: { event: HubEvent; count: number; key: string }[] = []
  for (const event of events) {
    const summary = Array.isArray(event.detail?.summary) ? (event.detail.summary as string[]) : []
    const key =
      summary.length === 1 ? `${event.origin}|${event.board}|${event.kind}|${summary[0]}` : `unique|${event.id}`
    const last = out.at(-1)
    if (last && last.key === key) last.count += 1
    else out.push({ event, count: 1, key })
  }
  return out
}

function formatEvent(event: HubEvent): string {
  const time = event.ts.slice(11, 19)
  const board = event.board ? ` ${event.board}` : ''
  let detail = ''
  if (event.detail) {
    const parts = Object.entries(event.detail).map(([key, value]) =>
      Array.isArray(value) ? `${key}: ${value.length <= 4 ? value.join(', ') : value.length}` : `${key}: ${String(value)}`,
    )
    if (parts.length > 0) detail = ` — ${parts.join('; ')}`
  }
  return `[${event.origin}] ${time} ${event.kind}${board}${detail}`
}

export function createHubServer(root: string = '', webDist?: string): McpServer {
  const server = new McpServer({ name: 'better-canvas', version: '0.2.0' })
  let preview: RunningServer | undefined
  const requireRoot = () => { if (!root) throw new Error('Choose a vault using open_vault first.') }
  server.server.onclose = () => { void preview?.close(); preview = undefined }

  const resolveBoard = async (board?: string): Promise<string> => {
    requireRoot()
    if (board) return board
    const active = await getActiveBoard(root)
    if (active) return active
    throw new Error('no active board — pass "board" or call set_active_board first (list_boards shows candidates)')
  }

  server.registerTool('open_vault', {
    title: 'Open a local vault', description: 'Choose the local folder explicitly provided by the user. This changes the scope of all tools. Does not scan other folders.',
    inputSchema: { path: z.string().describe('Absolute local vault path, supplied by the user') },
  }, async ({ path }) => {
    try {
      const resolved = await realpath(path)
      if (!(await stat(resolved)).isDirectory()) throw new Error('Vault must be a directory.')
      if (root !== resolved) { await preview?.close(); preview = undefined }
      root = resolved
      return text(JSON.stringify({ vault: root, boards: await listBoards(root) }))
    } catch (e) { return fail(e) }
  })
  server.registerTool('start_preview', {
    title: 'Start browser preview', description: 'Start the local Canvas editor for the selected vault and return its URL. Open the URL in the host browser panel. No separate AI chat is launched.',
    inputSchema: { port: z.number().int().min(0).max(65535).optional() },
  }, async ({ port }) => {
    try {
      requireRoot()
      preview ??= await startServe(root, { port: port ?? 0, webDist, handoffMode: 'signal' })
      return text(JSON.stringify({ url: `http://127.0.0.1:${preview.port}/`, vault: root }))
    } catch (e) { return fail(e) }
  })
  server.registerTool('get_selection', {
    title: 'Read selected cards', description: 'Read the connected browser selection, exact IDs, card content and current board revision. Multiple browser tabs require an explicit sessionId; stale selections are marked.',
    inputSchema: { sessionId: z.string().optional() },
  }, async ({ sessionId }) => { try { requireRoot(); return text(JSON.stringify(await getSelection(root, sessionId))) } catch (e) { return fail(e) } })
  server.registerTool('read_reference', {
    title: 'Read a card reference', description: 'Resolve a copied reference ID from the chat. Includes the original snapshot, current nodes and revision, and a stale flag.',
    inputSchema: { id: z.string() },
  }, async ({ id }) => { try { requireRoot(); return text(JSON.stringify(await readReference(root, id))) } catch (e) { return fail(e) } })
  server.registerTool('read_note', {
    title: 'Read a linked note', description: 'Read a vault-relative Markdown/text note, optionally one heading or block. Revision always refers to the entire file.',
    inputSchema: { path: z.string(), subpath: z.string().optional() },
  }, async ({ path, subpath }) => { try { requireRoot(); return text(JSON.stringify(await readNote(root, path, subpath))) } catch (e) { return fail(e) } })
  server.registerTool('update_note', {
    title: 'Update a linked note', description: 'Replace the full Markdown/text file after reading it without subpath. Preserve unrelated content and frontmatter. Requires the last read revision; keeps a recovery copy.',
    inputSchema: { path: z.string(), text: z.string().max(2 * 1024 * 1024), expectedRevision: z.string() },
  }, async ({ path, text: next, expectedRevision }) => {
    try {
      requireRoot()
      await readNote(root, path)
      return text(JSON.stringify({ path, revision: await writeVersioned(root, path, next, expectedRevision) }))
    } catch (e) { return fail(e) }
  })

  server.registerTool(
    'list_boards',
    {
      title: 'List boards',
      description:
        'List every .canvas discussion board under the root (repo), with node/edge counts and which board is active.',
      inputSchema: {},
    },
    async () => {
      try {
        requireRoot()
        const [boards, active] = await Promise.all([listBoards(root), getActiveBoard(root)])
        if (boards.length === 0) return text('no boards found — create one with create_board (e.g. "discuss/topic.canvas")')
        const lines = boards.map(
          (b) => `${b.path === active ? '● ' : '  '}${b.path} — ${b.nodes} nodes, ${b.edges} edges`,
        )
        lines.push('', active ? `active: ${active}` : 'active: (none set)')
        return text(lines.join('\n'))
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'create_board',
    {
      title: 'Create board',
      description: 'Create a new empty .canvas board at a repo-relative path (directories are created as needed).',
      inputSchema: { path: z.string().describe('e.g. "discuss/architecture.canvas"') },
    },
    async ({ path: rel }) => {
      try {
        requireRoot()
        await createBoard(root, rel)
        await appendEvent(root, { origin: 'agent', kind: 'board_created', board: rel })
        return text(`created ${rel}`)
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'set_active_board',
    {
      title: 'Set active board',
      description: 'Mark a board as the active discussion focus for this repo (humans and agents share this pointer).',
      inputSchema: { board: z.string() },
    },
    async ({ board }) => {
      try {
        requireRoot()
        await readBoardRaw(root, board) // verify it exists
        await setActiveBoard(root, board)
        await appendEvent(root, { origin: 'agent', kind: 'active_changed', board })
        return text(`active board: ${board}`)
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'get_active_board',
    {
      title: 'Get active board',
      description:
        'The board the human currently has in focus, with its structural projection (coordinate-free view). Start here.',
      inputSchema: {},
    },
    async () => {
      try {
        requireRoot()
        const active = await getActiveBoard(root)
        if (!active) {
          const boards = await listBoards(root)
          if (boards.length === 0) return text('no boards yet — create_board to start one')
          const fallback = boards.reduce((a, b) => (b.mtimeMs > a.mtimeMs ? b : a))
          const { data } = await readBoard(root, fallback.path)
          return text(
            `no active board set; showing most recently modified as fallback\n\n${structuralProjection(data, fallback.path).text}`,
          )
        }
        const { data } = await readBoard(root, active)
        return text(structuralProjection(data, active).text)
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'read_board',
    {
      title: 'Read board',
      description:
        'Read a board. mode "structure" (default) is the token-cheap coordinate-free view; "full" is the raw JSON Canvas.',
      inputSchema: {
        board: z.string().optional().describe('defaults to the active board'),
        mode: z.enum(['structure', 'full']).optional(),
      },
    },
    async ({ board, mode }) => {
      try {
        requireRoot()
        const rel = await resolveBoard(board)
        const raw = await readBoardRaw(root, rel)
        const { data } = parseCanvas(raw)
        const revision = revisionOf(raw)
        return { ...text(mode === 'full' ? raw : `revision: ${revision}\n${structuralProjection(data, rel).text}`), structuredContent: { board: rel, revision, data } }
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'apply_ops',
    {
      title: 'Apply semantic operations',
      description:
        'Edit a board with semantic ops (add_node/add_group/update_node/delete_node/connect/disconnect/move). ' +
        'Positions are computed for you — anchor new nodes to existing ones instead of thinking in pixels. ' +
        'Preserve existing coordinates unless the user requests movement. For anything sequence-shaped (timelines, fishbones, journeys) use rails: add_rail creates a horizontal or ' +
        'vertical arrow with evenly spaced slots, attach_to_rail/rail_reorder/rail_detach manage cards on it as an ' +
        'ordered list, and auto_layout never disturbs a rail. pin/unpin protect any other hand-arranged node. ' +
        'The batch is atomic: all ops apply or none do.',
      inputSchema: {
        board: z.string().optional().describe('defaults to the active board'),
        ops: z.array(opSchema).min(1),
        expectedRevision: z.string().describe('Revision returned by read_board. Conflicting edits are rejected.'),
      },
    },
    async ({ board, ops, expectedRevision }) => {
      try {
        requireRoot()
        const rel = await resolveBoard(board)
        const { data, style, revision: beforeRevision } = await readBoard(root, rel)
        if (beforeRevision !== expectedRevision) throw new ConflictError()
        const working = structuredClone(data) as CanvasData
        const result = applyOps(working, ops as Op[])
        await writeBoard(root, rel, working, style, expectedRevision)
        if (result.deleted.length > 0) await removePinned(root, rel, result.deleted)
        if (result.pins.length > 0) await addPinned(root, rel, result.pins)
        if (result.unpins.length > 0) await removePinned(root, rel, result.unpins)
        await appendEvent(root, { origin: 'agent', kind: 'ops_applied', board: rel, detail: { summary: result.summary } })
        const created = Object.entries(result.created)
          .filter(([k]) => !/^\$\d+$/.test(k))
          .map(([k, v]) => `${k} = ${v}`)
        const lines = [...result.summary]
        if (created.length > 0) lines.push('refs: ' + created.join(', '))
        return text(lines.join('\n'))
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'auto_layout',
    {
      title: 'Auto-layout board',
      description:
        'Only when the user explicitly requests rearranging: run ELK layered layout over the board. Human-arranged (pinned) nodes do not move — the rest flows around ' +
        'them; groups move as blocks. Use after larger edits; prefer anchors for small additions.',
      inputSchema: {
        board: z.string().optional(),
        direction: z.enum(['RIGHT', 'DOWN', 'LEFT', 'UP']).optional(),
        expectedRevision: z.string(),
      },
    },
    async ({ board, direction, expectedRevision }) => {
      try {
        requireRoot()
        const rel = await resolveBoard(board)
        const { data, style, revision: beforeRevision } = await readBoard(root, rel)
        if (beforeRevision !== expectedRevision) throw new ConflictError()
        const working = structuredClone(data) as CanvasData
        // rails are rigid by construction: their members join the pinned set for this pass
        const pinned = new Set([...(await getPinned(root, rel)), ...railMemberIds(working)])
        await autoLayout(working, { direction, pinned })
        await writeBoard(root, rel, working, style, expectedRevision)
        await appendEvent(root, { origin: 'agent', kind: 'layout', board: rel })
        return text(`re-laid out ${rel}${pinned.size > 0 ? ` (respected ${pinned.size} pinned nodes)` : ''}`)
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'events_since',
    {
      title: 'Events since cursor',
      description:
        'What happened on the boards since your last sync: human edits from the web client, Obsidian edits spotted ' +
        'by the watcher, and other agents. Pass the cursor from your previous call; omit it for the recent history.',
      inputSchema: { cursor: z.string().optional() },
    },
    async ({ cursor }) => {
      try {
        requireRoot()
        const { events, cursor: next } = await readEventsSince(root, cursor)
        if (events.length === 0) return text(cursor ? `no new events\ncursor: ${cursor}` : 'no events yet')
        const lines = coalesceEvents(events).map(({ event, count }) => formatEvent(event) + (count > 1 ? ` ×${count}` : ''))
        lines.push(`cursor: ${next}`)
        return text(lines.join('\n'))
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'post_chat',
    {
      title: 'Post to chat',
      description:
        'Reply in the text side-channel (the chat panel next to the board). Use this for prose — not every reply ' +
        'deserves a card. Use apply_ops when the reply is structural or spatial.',
      inputSchema: { text: z.string().min(1), board: z.string().optional() },
    },
    async ({ text: message, board }) => {
      try {
        requireRoot()
        await appendChat(root, { from: 'agent', text: message, board })
        return text('posted')
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'read_chat',
    {
      title: 'Read chat',
      description: 'Read the text side-channel. Pass the cursor from your previous call to get only new messages.',
      inputSchema: { since: z.string().optional() },
    },
    async ({ since }) => {
      try {
        requireRoot()
        const { messages, cursor } = await readChatSince(root, since)
        if (messages.length === 0) return text(since ? `no new messages\ncursor: ${since}` : 'no messages yet')
        const lines = messages.map((m) => `${m.from} (${m.ts.slice(11, 16)}): ${m.text}`)
        lines.push(`cursor: ${cursor}`)
        return text(lines.join('\n'))
      } catch (e) {
        return fail(e)
      }
    },
  )

  return server
}

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ConflictError } from './storage.ts'
import { readBoard } from './boards.ts'

const validId = /^[a-zA-Z0-9_-]{1,100}$/
export interface Selection {
  sessionId: string
  board: string
  nodeIds: string[]
  edgeIds: string[]
  revision: string
  updatedAt: number
}

export async function saveSelection(root: string, input: Omit<Selection, 'updatedAt'>): Promise<Selection> {
  if (!validId.test(input.sessionId)) throw new Error('Invalid browser session ID.')
  if (!Array.isArray(input.nodeIds) || !Array.isArray(input.edgeIds) || input.nodeIds.length + input.edgeIds.length > 1000) throw new Error('Invalid selection.')
  const { data } = await readBoard(root, input.board)
  const nodeSet = new Set((data.nodes ?? []).map(n => n.id))
  const edgeSet = new Set((data.edges ?? []).map(e => e.id))
  const selection = { ...input, nodeIds: [...new Set(input.nodeIds)].filter(id => nodeSet.has(id)), edgeIds: [...new Set(input.edgeIds)].filter(id => edgeSet.has(id)), updatedAt: Date.now() }
  const dir = path.join(root, '.better-canvas', 'selections')
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, `${input.sessionId}.json`)
  const tmp = `${file}.${randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(selection))
  await rename(tmp, file)
  return selection
}

export async function getSelection(root: string, sessionId?: string) {
  const dir = path.join(root, '.better-canvas', 'selections')
  const files = await readdir(dir).catch(() => [])
  const sessions: Selection[] = []
  for (const file of files.filter(f => f.endsWith('.json'))) {
    try {
      const s = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as Selection
      if (Date.now() - s.updatedAt < 90_000 && (!sessionId || sessionId === s.sessionId)) sessions.push(s)
    } catch { /* a closed browser leaves an expiring record */ }
  }
  if (sessions.length !== 1) return { status: sessions.length ? 'ambiguous' : 'no_browser', sessions }
  const s = sessions[0]!
  const { data, revision } = await readBoard(root, s.board)
  return { status: 'selected', ...s, revision, selectionRevision: s.revision, stale: s.revision !== revision,
    nodes: (data.nodes ?? []).filter(n => s.nodeIds.includes(n.id)), edges: (data.edges ?? []).filter(e => s.edgeIds.includes(e.id)) }
}

export async function createReference(root: string, input: Omit<Selection, 'updatedAt'>) {
  const s = await saveSelection(root, input)
  const { data, revision } = await readBoard(root, s.board)
  if (input.revision !== revision) throw new ConflictError()
  const id = randomUUID()
  const value = { id, board: s.board, nodeIds: s.nodeIds, edgeIds: s.edgeIds, revision,
    nodes: (data.nodes ?? []).filter(n => s.nodeIds.includes(n.id)), edges: (data.edges ?? []).filter(e => s.edgeIds.includes(e.id)), createdAt: new Date().toISOString() }
  if (!value.nodes.length && !value.edges.length) throw new Error('Select one or more cards first.')
  const dir = path.join(root, '.better-canvas', 'references')
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, `${id}.json`), JSON.stringify(value))
  return { ...value, citation: `[Canvas: ${s.board}] (reference: ${id}; nodes: ${s.nodeIds.join(', ') || 'none'}; edges: ${s.edgeIds.join(', ') || 'none'})` }
}

export async function readReference(root: string, id: string) {
  if (!validId.test(id)) throw new Error('Invalid reference ID.')
  const reference = JSON.parse(await readFile(path.join(root, '.better-canvas', 'references', `${id}.json`), 'utf8'))
  const { data, revision } = await readBoard(root, reference.board)
  return { ...reference, currentRevision: revision, stale: revision !== reference.revision,
    currentNodes: (data.nodes ?? []).filter(n => reference.nodeIds.includes(n.id)) }
}

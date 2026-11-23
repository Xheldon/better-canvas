import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MissingTargetsError, type CanvasData } from '@better-canvas/core'
import { readBoard } from './boards.ts'
import { readForWrite } from './storage.ts'

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
  if (typeof input.sessionId !== 'string' || !validId.test(input.sessionId)) throw new Error('Invalid browser session ID.')
  if (typeof input.board !== 'string' || typeof input.revision !== 'string' || !input.revision) throw new Error('Selection needs a board and revision.')
  if (!Array.isArray(input.nodeIds) || !Array.isArray(input.edgeIds) || input.nodeIds.length + input.edgeIds.length > 1000 || ![...input.nodeIds,...input.edgeIds].every(id => typeof id === 'string')) throw new Error('Invalid selection.')
  const selection = { sessionId: input.sessionId, board: input.board, revision: input.revision, nodeIds: [...new Set(input.nodeIds)], edgeIds: [...new Set(input.edgeIds)], updatedAt: Date.now() }
  const dir = path.join(root, '.better-canvas', 'selections')
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, `${input.sessionId}.json`)
  const tmp = `${file}.${randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(selection))
  await rename(tmp, file)
  return selection
}

export async function getSelection(root: string, sessionId?: string, isOpen: (id: string) => boolean = () => false) {
  const dir = path.join(root, '.better-canvas', 'selections')
  const files = await readdir(dir).catch(() => [])
  const sessions: Selection[] = []
  for (const file of files.filter(f => f.endsWith('.json'))) {
    try {
      const s = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as Selection
      if ((Date.now() - s.updatedAt < 90_000 || isOpen(s.sessionId)) && (!sessionId || sessionId === s.sessionId)) sessions.push(s)
    } catch { /* a closed browser leaves an expiring record */ }
  }
  if (sessions.length !== 1) return { status: sessions.length ? 'ambiguous' : 'no_browser', sessions }
  const s = sessions[0]!
  const { data, revision } = await readBoard(root, s.board)
  return { status: 'selected', ...s, revision, selectionRevision: s.revision, stale: s.revision !== revision,
    nodes: (data.nodes ?? []).filter(n => s.nodeIds.includes(n.id)), edges: (data.edges ?? []).filter(e => s.edgeIds.includes(e.id)) }
}

export function checkTargets(data: CanvasData, targets: { nodeIds: string[]; edgeIds: string[] }) {
  const nodes = new Set(data.nodes?.map(n => n.id))
  const edges = new Set(data.edges?.map(e => e.id))
  const missingNodes = targets.nodeIds.filter(id => !nodes.has(id))
  const missingEdges = targets.edgeIds.filter(id => !edges.has(id))
  if (missingNodes.length || missingEdges.length) throw new MissingTargetsError(missingNodes, missingEdges)
}

export async function createReference(root: string, input: Omit<Selection, 'updatedAt'>) {
  const s = await saveSelection(root, input)
  const { data, revision } = await readForWrite(() => readBoard(root, s.board))
  checkTargets(data, s)
  const id = randomUUID()
  const value = { id, sessionId: s.sessionId, board: s.board, nodeIds: s.nodeIds, edgeIds: s.edgeIds, revision,
    nodes: (data.nodes ?? []).filter(n => s.nodeIds.includes(n.id)), edges: (data.edges ?? []).filter(e => s.edgeIds.includes(e.id)), createdAt: new Date().toISOString() }
  if (!value.nodes.length && !value.edges.length) throw new Error('Select one or more cards first.')
  const dir = path.join(root, '.better-canvas', 'references')
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, `${id}.json`), JSON.stringify(value))
  return { ...value, citation: `[Canvas: ${s.board}] (reference: ${id}; nodes: ${s.nodeIds.join(', ') || 'none'}; edges: ${s.edgeIds.join(', ') || 'none'})` }
}

export async function loadReference(root: string, id: string) {
  if (!validId.test(id)) throw new Error('Invalid reference ID.')
  return JSON.parse(await readFile(path.join(root, '.better-canvas', 'references', `${id}.json`), 'utf8')) as
    Pick<Selection, 'board' | 'nodeIds' | 'edgeIds' | 'revision'> & { id: string; sessionId?: string; nodes: CanvasData['nodes']; edges: CanvasData['edges'] }
}

export async function readReference(root: string, id: string, reference?: Awaited<ReturnType<typeof loadReference>>) {
  reference ??= await loadReference(root, id)
  const board = reference.board
  const { data, revision } = await readForWrite(() => readBoard(root, board))
  checkTargets(data, reference)
  return { ...reference, currentRevision: revision, stale: revision !== reference.revision,
    currentNodes: (data.nodes ?? []).filter(n => reference.nodeIds.includes(n.id)), currentEdges: (data.edges ?? []).filter(e => reference.edgeIds.includes(e.id)) }
}

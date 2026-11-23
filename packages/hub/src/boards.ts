import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { revisionOf, vaultPath, writeVersioned } from './storage.ts'
import {
  parseCanvas,
  validateCanvas,
  serializeCanvas,
  nodes,
  edges,
  DEFAULT_STYLE,
  type CanvasData,
  type CanvasStyle,
} from '@better-canvas/core'

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage'])

export interface BoardInfo {
  /** repo-relative path, the board's id */
  path: string
  nodes: number
  edges: number
  mtimeMs: number
}

export async function listBoards(root: string, onRead?: (rel: string, text: string, data: CanvasData) => void): Promise<BoardInfo[]> {
  const found: string[] = []
  await walk(root, '', found)
  const infos: BoardInfo[] = []
  for (const rel of found.sort()) {
    try {
      const abs = await vaultPath(root, rel)
      const [text, s] = await Promise.all([readFile(abs, 'utf8'), stat(abs)])
      const { data } = parseCanvas(text)
      infos.push({ path: rel, nodes: nodes(data).length, edges: edges(data).length, mtimeMs: s.mtimeMs })
      onRead?.(rel, text, data)
    } catch {
      // unreadable or malformed board: skip rather than fail the listing
    }
  }
  return infos
}

async function walk(root: string, rel: string, out: string[]): Promise<void> {
  const entries = await readdir(path.join(root, rel), { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      await walk(root, path.posix.join(rel, entry.name), out)
    } else if (entry.isFile() && entry.name.endsWith('.canvas')) {
      out.push(path.posix.join(rel, entry.name))
    }
  }
}

/** Resolve a board reference safely inside the root; always returns an absolute path. */
export function boardAbsPath(root: string, rel: string): string {
  if (!rel.endsWith('.canvas')) throw new Error(`board paths end in .canvas (got "${rel}")`)
  const abs = path.resolve(root, rel)
  const rootAbs = path.resolve(root) + path.sep
  if (!abs.startsWith(rootAbs)) throw new Error(`board path escapes the root: "${rel}"`)
  return abs
}

export interface LoadedBoard {
  data: CanvasData
  style: CanvasStyle
  revision: string
}

export async function readBoard(root: string, rel: string): Promise<LoadedBoard> {
  boardAbsPath(root, rel)
  const text = await readFile(await vaultPath(root, rel), 'utf8')
  if (!text.trim()) throw new Error('Canvas file is empty or still being written.')
  const parsed = parseCanvas(text)
  validateCanvas(parsed.data)
  return { ...parsed, revision: revisionOf(text) }
}

export async function readBoardRaw(root: string, rel: string): Promise<string> {
  boardAbsPath(root, rel)
  return readFile(await vaultPath(root, rel), 'utf8')
}

/** Atomic write (temp file + rename) so Obsidian never sees a torn board. */
export async function writeBoard(root: string, rel: string, data: CanvasData, style: CanvasStyle, expectedRevision?: string): Promise<string> {
  boardAbsPath(root, rel)
  return writeVersioned(root, rel, serializeCanvas(data, style), expectedRevision)
}

export async function createBoard(root: string, rel: string): Promise<void> {
  boardAbsPath(root, rel)
  const abs = await vaultPath(root, rel)
  try {
    await stat(abs)
    throw new Error(`board already exists: "${rel}"`)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  await mkdir(path.dirname(abs), { recursive: true })
  await writeBoard(root, rel, { nodes: [], edges: [] }, DEFAULT_STYLE)
}

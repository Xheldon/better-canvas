import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
export async function getActiveBoard(root: string): Promise<string | undefined> {
  try { return JSON.parse(await readFile(path.join(root, '.better-canvas/state.json'), 'utf8')).activeBoard }
  catch { return undefined }
}
export async function setActiveBoard(root: string, board: string): Promise<void> {
  const dir = path.join(root, '.better-canvas')
  await mkdir(dir, { recursive: true })
  const tmp = path.join(dir, randomUUID() + '.tmp')
  await writeFile(tmp, JSON.stringify({ activeBoard: board }))
  await rename(tmp, path.join(dir, 'state.json'))
}

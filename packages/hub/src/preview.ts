import { readFile, realpath, stat } from 'node:fs/promises'
import { validateCanvas, type CanvasData } from '@better-canvas/core'
import path from 'node:path'
import { listBoards, readBoard } from './boards.ts'
import { getActiveBoard } from './state.ts'
import { readNote, revisionOf, vaultPath } from './storage.ts'
import { type Workspace, workspaceId } from './workspace.ts'
export async function previewSnapshot(root: string, requested?: string) {
  const preferred = requested ?? await getActiveBoard(root)
  let board: string | undefined
  let snapshot: { revision: string; data: CanvasData } | undefined, empty = false
  const boards = await listBoards(root, (rel, text, data) => {
    if (rel === preferred || (!requested && !board)) {
      board = rel
      empty = !text.trim()
      snapshot = { revision: revisionOf(text), data }
    }
  })
  if (requested && !snapshot) { board = requested; snapshot = await readBoard(root, requested) }
  if (empty) throw new Error('Canvas file is empty or still being written.')
  if (snapshot) validateCanvas(snapshot.data)
  return { workspaceId: workspaceId(root), directory: root, directoryName: path.basename(root), vaultName: path.basename(root), boards, board, revision: snapshot?.revision, data: snapshot?.data }
}
export async function workspacePreview(workspace: Workspace, requested?: string, expectedWorkspaceId?: string) {
  if (!workspace.root) return { ...workspace.info(), needsVault: true, boards: [] }
  return previewSnapshot(workspace.root, expectedWorkspaceId && expectedWorkspaceId !== workspace.id ? undefined : requested)
}
const images: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' }
export async function previewFile(root: string, rel: string, subpath?: string) {
  const note = /\.(md|markdown|txt)$/i.test(rel)
  const mime = images[path.extname(rel).toLowerCase()]
  if (!note && !mime) return { kind: 'unsupported', path: rel }
  const abs = await vaultPath(root, rel)
  const watchPath = path.relative(root, await realpath(abs)).split(path.sep).join('/')
  if (note) return { kind: 'note', watchPath, ...await readNote(root, rel, subpath) }
  if ((await stat(abs)).size > 5 * 1024 * 1024) throw new Error('Image is too large for preview (5 MB limit).')
  return { kind: 'image', path: rel, watchPath, src: 'data:' + mime + ';base64,' + (await readFile(abs)).toString('base64') }
}

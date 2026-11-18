import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { listBoards, readBoard } from './boards.ts'
import { getActiveBoard } from './state.ts'
import { readNote, vaultPath } from './storage.ts'
import { type Workspace, workspaceId } from './workspace.ts'
export async function previewSnapshot(root: string, requested?: string) {
  const boards = await listBoards(root)
  const preferred = requested ?? await getActiveBoard(root)
  const board = requested ?? (boards.some(b => b.path === preferred) ? preferred : boards[0]?.path)
  const snapshot = board ? await readBoard(root, board) : undefined
  return { workspaceId: workspaceId(root), directory: root, directoryName: path.basename(root), vaultName: path.basename(root), boards, board, revision: snapshot?.revision, data: snapshot?.data }
}
export async function workspacePreview(workspace: Workspace, requested?: string, expectedWorkspaceId?: string) {
  if (!workspace.root) return { ...workspace.info(), needsVault: true, boards: [] }
  return previewSnapshot(workspace.root, expectedWorkspaceId && expectedWorkspaceId !== workspace.id ? undefined : requested)
}
const images: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' }
export async function previewFile(root: string, rel: string, subpath?: string) {
  if (/\.(md|markdown|txt)$/i.test(rel)) return { kind: 'note', ...await readNote(root, rel, subpath) }
  const mime = images[path.extname(rel).toLowerCase()]
  if (!mime) return { kind: 'unsupported', path: rel }
  const abs = await vaultPath(root, rel)
  if ((await stat(abs)).size > 5 * 1024 * 1024) throw new Error('Image is too large for preview (5 MB limit).')
  return { kind: 'image', path: rel, src: 'data:' + mime + ';base64,' + (await readFile(abs)).toString('base64') }
}

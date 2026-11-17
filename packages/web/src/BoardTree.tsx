import { useState } from 'react'
import type { BoardInfo } from './api'

interface Props {
  boards: BoardInfo[]; current: string | null; active: string | null; coarse: boolean
  onOpen(path: string): void; onNewBoard(folder?: string): void
  onDelete(path: string): void; onRename(from: string, to: string): void
}
interface Folder { folders: Map<string, Folder>; boards: BoardInfo[] }
export function BoardTree({ boards, current, onOpen, onRename, onDelete }: Props) {
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<string | null>(null)
  const root: Folder = { folders: new Map(), boards: [] }
  for (const board of boards) {
    const parts = board.path.split('/'); parts.pop()
    let folder = root
    for (const part of parts) {
      if (!folder.folders.has(part)) folder.folders.set(part, { folders: new Map(), boards: [] })
      folder = folder.folders.get(part)!
    }
    folder.boards.push(board)
  }
  const render = (folder: Folder, prefix = '', depth = 0) => <>
    {[...folder.folders].sort(([a],[b]) => a.localeCompare(b)).map(([name, child]) => {
      const path = prefix + name + '/'
      return <div key={path} className="bc-folder-branch"><button className="bc-folder-row" style={{ paddingLeft: 12 + depth * 14 }} aria-expanded={!closed.has(path)} onClick={() => setClosed(old => { const next = new Set(old); next.has(path) ? next.delete(path) : next.add(path); return next })}><span>{closed.has(path) ? '›' : '⌄'}</span><span>{name}</span></button>{!closed.has(path) && render(child, path, depth + 1)}</div>
    })}
    {folder.boards.map(board => <div className={'bc-file' + (current === board.path ? ' selected' : '')} key={board.path}>
      <button className="bc-file-open" aria-current={current === board.path ? 'page' : undefined} title={board.path} style={{ paddingLeft: 12 + depth * 14 }} onClick={() => { onOpen(board.path); setMenu(null) }}><span className="bc-file-glyph">▧</span><span>{board.path.split('/').at(-1)!.replace(/\.canvas$/, '')}</span><small>{board.nodes}</small></button>
      <button className="bc-file-more" aria-label={'Actions for ' + board.path} aria-expanded={menu === board.path} onClick={() => setMenu(m => m === board.path ? null : board.path)}>···</button>
      {menu === board.path && <div className="bc-file-actions"><button onClick={() => { const name = window.prompt('New vault-relative path', board.path); setMenu(null); if (name && name !== board.path) onRename(board.path, name) }}>Rename</button><button onClick={() => { setMenu(null); onDelete(board.path) }}>Remove</button></div>}
    </div>)}
  </>
  return <div className="bc-tree">{render(root)}</div>
}

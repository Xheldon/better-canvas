import { useEffect, useMemo, useState } from 'react'
import type { Snapshot } from './client'
import { s } from './strings'

interface Entry { name: string; path: string; children?: Map<string, Entry> }
function ancestors(file?: string) {
  const parts = file?.split('/') ?? []
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
}
export function FolderTree({ boards, active, query, onChoose }: {
  boards: Snapshot['boards']; active?: string; query: string; onChoose(path: string): void
}) {
  const [expanded, setExpanded] = useState(() => new Set(ancestors(active)))
  useEffect(() => { setExpanded(previous => new Set([...previous, ...ancestors(active)])) }, [active])
  const filter = query.trim().toLocaleLowerCase()
  const tree = useMemo(() => {
    const root = new Map<string, Entry>()
    for (const board of boards) {
      if (!board.path.toLocaleLowerCase().includes(filter)) continue
      const parts = board.path.split('/')
      let level = root
      parts.forEach((name, i) => {
        if (!level.has(name)) level.set(name, { name, path: parts.slice(0, i + 1).join('/'), ...(i < parts.length - 1 ? { children: new Map() } : {}) })
        const entry = level.get(name)!
        if (entry.children) level = entry.children
      })
    }
    return root
  }, [boards, filter])
  useEffect(() => {
    if (filter) setExpanded(new Set(boards.filter(b => b.path.toLocaleLowerCase().includes(filter)).flatMap(b => ancestors(b.path))))
  }, [boards, filter])
  function entries(level: Map<string, Entry>) {
    return <ul className="tree-level">{[...level.values()].sort((a, b) => Number(!!b.children) - Number(!!a.children) || a.name.localeCompare(b.name, undefined, { numeric: true })).map(entry => {
      const open = expanded.has(entry.path)
      return <li key={entry.path}>
        {entry.children ? <>
          <button type="button" className="folder-row" title={entry.path} aria-expanded={open} onClick={() => setExpanded(previous => {
            const next = new Set(previous); if (next.has(entry.path)) next.delete(entry.path); else next.add(entry.path); return next
          })}>
            <span className={'folder-chevron ' + (open ? 'open' : '')} aria-hidden="true">›</span>
            <svg className="folder-icon" aria-hidden="true" viewBox="0 0 20 20"><path d="M2 5h6l2 2h8v10H2Z" /></svg>
            <span className="file-name">{entry.name}</span>
          </button>
          {open && <div className="tree-children">{entries(entry.children)}</div>}
        </> : <button type="button" title={entry.path} className={'file-row ' + (entry.path === active ? 'active' : '')}
          onClick={() => onChoose(entry.path)} aria-current={entry.path === active ? 'page' : undefined}>
          <span className="file-icon" aria-hidden="true">▧</span><span className="file-name">{entry.name.replace(/\.canvas$/, '')}</span><span className="tree-extension">.canvas</span>
        </button>}
      </li>
    })}</ul>
  }
  return tree.size ? entries(tree) : <p className="sidebar-empty">{filter ? s.noResults : s.noBoards}</p>
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, connectHub, type BoardInfo } from './api'
import { BoardTree } from './BoardTree'
import { CanvasBoard } from './board/CanvasBoard'
import { Settings } from './Settings'

export function App() {
  const [boards, setBoards] = useState<BoardInfo[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [root, setRoot] = useState('')
  const [filter, setFilter] = useState('')
  const [sideOpen, setSideOpen] = useState(true)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [changeSignal, setChangeSignal] = useState(0)
  const [help, setHelp] = useState(false)
  const currentRef = useRef(current)
  currentRef.current = current
  const refresh = useCallback(async () => {
    try {
      const r = await api.boards()
      setBoards(r.boards); setRoot(r.root ?? 'Vault')
      setCurrent(old => r.boards.some(b => b.path === old) ? old : r.active && r.boards.some(b => b.path === r.active) ? r.active : r.boards[0]?.path ?? null)
      setError('')
    } catch (e) { setError(String(e)) }
  }, [])
  useEffect(() => {
    void refresh()
    const close = connectHub(message => {
      if (message.type === 'boards_changed' || message.type === 'hello') void refresh()
      if (message.type === 'hello' || (message.type === 'board_changed' && message.board === currentRef.current)) setChangeSignal(n => n + 1)
      if (message.type === 'file_changed') window.dispatchEvent(new CustomEvent('better-canvas:file-changed', { detail: message.path }))
      if (message.type === 'sync_error') setError(message.error)
      if (message.type === 'active_changed' && message.active) setCurrent(message.active)
    }, setConnected)
    const onVisible = () => { if (document.visibilityState === 'visible') { void refresh(); setChangeSignal(n => n + 1) } }
    document.addEventListener('visibilitychange', onVisible)
    return () => { close(); document.removeEventListener('visibilitychange', onVisible) }
  }, [refresh])
  const create = async (folder = '') => {
    const name = window.prompt('Canvas path inside this vault', (folder ? folder + '/' : '') + 'Untitled.canvas')
    if (!name) return
    try { await api.createBoard(name); await refresh(); setCurrent(name) } catch (e) { setError(String(e)) }
  }
  const remove = async (path: string) => {
    if (!window.confirm('Remove ' + path + '? A recovery copy is kept in .better-canvas/history.')) return
    try { await api.deleteBoard(path); await refresh() } catch (e) { setError(String(e)) }
  }
  const rename = async (from: string, to: string) => {
    try { await api.renameBoard(from, to); setCurrent(c => c === from ? to : c); await refresh() } catch (e) { setError(String(e)) }
  }
  return <div className={'bc-app' + (sideOpen ? '' : ' sidebar-hidden')}>
    <aside className="bc-sidebar" aria-label="Canvas files">
      <header className="bc-brand"><span className="bc-mark" aria-hidden="true">▧</span><div><strong>Better Canvas</strong><span>Your canvas, connected.</span></div><Settings /></header>
      <div className="bc-vault"><span>VAULT</span><strong title={root}>{root}</strong></div>
      <label className="bc-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Find a canvas" placeholder="Find a canvas…" value={filter} onChange={e => setFilter(e.target.value)} /></label>
      <nav className="bc-file-list" aria-label="Boards">
        <BoardTree boards={boards.filter(b => b.path.toLowerCase().includes(filter.toLowerCase()))} active={null} current={current} coarse={false} onOpen={setCurrent} onNewBoard={f => void create(f)} onDelete={p => void remove(p)} onRename={(a,b) => void rename(a,b)} />
        {!boards.length && <p className="bc-empty">No canvases yet. Create one to begin.</p>}
      </nav>
      <button className="bc-new" onClick={() => void create()}>＋ New canvas</button>
      <footer className="bc-sidebar-foot"><span className={'bc-status' + (connected ? ' connected' : '')} />{connected ? 'Watching local files' : 'Reconnecting…'}<button onClick={() => setHelp(true)} aria-label="How to work with AI">?</button></footer>
    </aside>
    <main className="bc-workspace">
      <header className="bc-topbar"><button className="bc-icon" onClick={() => setSideOpen(s => !s)} aria-label="Toggle file list">☰</button><div className="bc-breadcrumb" title={current ?? ''}><span>{root}</span><span>/</span><strong>{current?.replace(/\.canvas$/, '') ?? 'No canvas selected'}</strong></div><button className="bc-help" onClick={() => setHelp(true)}>Working with AI ↗</button></header>
      {error && <div className="bc-error" role="alert">{error}<button onClick={() => { setError(''); void refresh() }}>Retry</button></div>}
      <div className="bc-stage">{current ? <CanvasBoard key={current} path={current} changeSignal={changeSignal} /> : <div className="bc-welcome"><span className="bc-mark">▧</span><h1>A little room to think.</h1><p>Open a canvas from your vault, or create one.</p><button onClick={() => void create()}>Create a canvas</button></div>}</div>
    </main>
    {help && <div className="bc-dialog-backdrop" onClick={() => setHelp(false)}><section className="bc-dialog" role="dialog" aria-modal="true" aria-label="Working with AI" onClick={e => e.stopPropagation()}><button className="bc-dialog-close" onClick={() => setHelp(false)} aria-label="Close help">×</button><h2>Keep the conversation in your chat.</h2><ol><li>Select a card. Hold Shift and drag to select several.</li><li>Right-click → <strong>Ask AI about selection</strong>, then copy the reference into your chat with your request.</li><li>The connected AI reads the reference and edits the original canvas through MCP.</li></ol><p>You can also use your host browser’s annotation tool. Selected cards are available through <code>get_selection</code>.</p><p className="bc-muted">Opening this page does not connect an AI client automatically. Install the Better Canvas plugin or configure its MCP server first.</p></section></div>}
  </div>
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { connectClient, type Client, type Selection, type Snapshot } from './client'
import { CanvasViewer } from './CanvasViewer'
import { Composer } from './Composer'
import { s } from './strings'

function AppWithClient({ client }: { client: Client }) {
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [sidebar, setSidebar] = useState(window.innerWidth > 850)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [fileTick, setFileTick] = useState(0)
  const [sessionId] = useState(() => crypto.randomUUID())
  const boardRef = useRef<string | undefined>(client.mode === 'browser' ? new URLSearchParams(location.search).get('board') ?? undefined : undefined), refreshCounter = useRef(0)
  const inFlight = useRef(false)
  const refresh = useCallback(async (requested?: string, switchBoard = false) => {
    if (inFlight.current && !switchBoard) return
    const token = ++refreshCounter.current
    if (switchBoard) { boardRef.current = requested; setPending(true) }
    inFlight.current = true
    try {
      const value = await client.preview(requested ?? boardRef.current)
      if (token !== refreshCounter.current) return
      boardRef.current = value.board
      setSnapshot(previous => {
        if (previous && previous.board === value.board && previous?.revision === value.revision && JSON.stringify(previous.boards) === JSON.stringify(value.boards)) return previous
        return value
      })
      setSelected(ids => ids.filter(id => value.data?.nodes?.some(n => n.id === id)))
      setError('')
    } catch (e) { if (token === refreshCounter.current) setError((e as Error).message) }
    finally { if (token === refreshCounter.current) { inFlight.current = false; setPending(false) } }
  }, [client])
  useEffect(() => {
    void refresh()
    return client.subscribe(() => { void refresh(); setFileTick(t => t + 1) })
  }, [client, refresh])
  const selection: Selection | undefined = snapshot?.board && snapshot.revision
    ? { sessionId, board: snapshot.board, nodeIds: selected, edgeIds: [], revision: snapshot.revision } : undefined
  useEffect(() => {
    if (!selection || pending) return
    const save = () => { void client.selection(selection).catch(() => {}) }
    save(); const timer = setInterval(save, 30_000)
    return () => clearInterval(timer)
  }, [client, sessionId, snapshot?.board, snapshot?.revision, selected, pending])
  const boards = (snapshot?.boards ?? []).filter(b => b.path.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const choose = (board: string) => {
    if (client.mode === 'browser') {
      const url = new URL(location.href)
      url.searchParams.set('board', board)
      history.replaceState(null, '', url)
    }
    setSelected([]); setError(''); void refresh(board, true)
    if (window.innerWidth < 700) setSidebar(false)
  }
  return <div className={'app-shell ' + (sidebar ? 'with-sidebar' : '')}>
    {sidebar && <aside className="sidebar">
      <div className="brand"><span className="brand-mark">▧</span><span>Better Canvas</span><button type="button" className="quiet-button" onClick={() => setSidebar(false)} aria-label={s.hide}>‹</button></div>
      <div className="vault-name">{snapshot?.vaultName ?? s.files}</div>
      <input className="file-search" type="search" placeholder={s.search} aria-label={s.search} value={query} onChange={e => setQuery(e.target.value)} />
      <nav className="file-list" aria-label={s.files}>
        {boards.map(board => {
          const parts = board.path.split('/'), name = parts.pop()!
          return <button type="button" key={board.path} title={board.path} className={'file-row ' + (board.path === snapshot?.board ? 'active' : '')}
            onClick={() => choose(board.path)} aria-current={board.path === snapshot?.board ? 'page' : undefined}>
            <span className="file-icon">▧</span><span className="file-name">{name.replace(/\.canvas$/, '')}{parts.length > 0 && <small>{parts.join(' / ')}</small>}</span>
          </button>
        })}
        {!boards.length && snapshot && <p className="sidebar-empty">{query ? s.noResults : s.noBoards}</p>}
      </nav>
      <div className="sidebar-footer"><span className="lock-symbol">◇</span>{s.readOnly}<small>v0.3</small></div>
    </aside>}
    <main className="main">
      <header className="topbar">
        {!sidebar && <button type="button" className="quiet-button sidebar-toggle" onClick={() => setSidebar(true)} aria-label={s.show}>☰</button>}
        <div className="breadcrumb"><span>▧</span><strong title={snapshot?.board}>{snapshot?.board?.split('/').pop()?.replace(/\.canvas$/, '') ?? 'Better Canvas'}</strong><span className="extension">.canvas</span></div>
        <span className="read-only-badge">{s.readOnly}</span>
        <button type="button" className="quiet-button refresh-button" onClick={() => { void refresh(); setFileTick(t => t + 1) }} aria-label={s.refresh} title={s.refresh}>↻</button>
      </header>
      {error && <div className="error-banner" role="alert">{error}<button onClick={() => void refresh()}>{s.retry}</button></div>}
      <div className="canvas-stage">
        {snapshot?.data && snapshot.board ? <CanvasViewer key={snapshot.board} client={client} data={snapshot.data} selected={selected} onSelect={setSelected} refreshKey={fileTick} />
          : <div className="loading-state">{snapshot?.needsVault ? s.needsVault : snapshot ? s.noBoards : error ? s.error : s.loading}</div>}
        {pending && <div className="switching-board">{s.loading}</div>}
      </div>
      <Composer key={snapshot?.board ?? 'none'} client={client} cards={(snapshot?.data?.nodes ?? []).filter(n => selected.includes(n.id))}
        selection={selection} onRemove={id => setSelected(ids => ids.filter(i => i !== id))} onClear={() => setSelected([])} ready={!pending && !error} />
    </main>
  </div>
}
export function App() {
  const [client, setClient] = useState<Client>()
  const [error, setError] = useState('')
  useEffect(() => { void connectClient().then(setClient).catch(e => setError(e.message)) }, [])
  if (!client) return <div className="loading-state">{error || s.waiting}</div>
  return <AppWithClient client={client} />
}

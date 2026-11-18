import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { connectClient, type Client, type Selection, type Snapshot } from './client'
import { CanvasViewer } from './CanvasViewer'
import { Composer } from './Composer'
import { s } from './strings'
import { FolderTree } from './FolderTree'
import { DirectorySettings } from './DirectorySettings'

export function AppWithClient({ client }: { client: Client }) {
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [sidebar, setSidebar] = useState(window.innerWidth > 850)
  const [settings, setSettings] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [fileTick, setFileTick] = useState(0)
  const [sessionId] = useState(() => crypto.randomUUID())
  const boardRef = useRef<string | undefined>(client.mode === 'browser' ? new URLSearchParams(location.search).get('board') ?? undefined : undefined), refreshCounter = useRef(0)
  const inFlight = useRef(false)
  const directoryChanging = useRef(false)
  const workspaceRef = useRef<string | undefined>(undefined)
  const acceptSnapshot = useCallback((value: Snapshot) => {
    const changed = workspaceRef.current !== undefined && workspaceRef.current !== value.workspaceId
    workspaceRef.current = value.workspaceId
    boardRef.current = value.board
    setSnapshot(previous => previous && previous.workspaceId === value.workspaceId && previous.board === value.board && previous.revision === value.revision && JSON.stringify(previous.boards) === JSON.stringify(value.boards) ? previous : value)
    setSelected(ids => changed ? [] : ids.filter(id => value.data?.nodes?.some(n => n.id === id)))
    if (changed) setQuery('')
    if (client.mode === 'browser') {
      const url = new URL(location.href)
      if (value.board) url.searchParams.set('board', value.board); else url.searchParams.delete('board')
      history.replaceState(null, '', url)
    }
    setError('')
  }, [client])
  const refresh = useCallback(async (requested?: string, switchBoard = false) => {
    if (directoryChanging.current || (inFlight.current && !switchBoard)) return
    const token = ++refreshCounter.current
    if (switchBoard) { boardRef.current = requested; setPending(true) }
    inFlight.current = true
    try {
      const value = await client.preview(requested ?? boardRef.current, workspaceRef.current)
      if (token !== refreshCounter.current) return
      acceptSnapshot(value)
    } catch (e) { if (token === refreshCounter.current) setError((e as Error).message) }
    finally { if (token === refreshCounter.current) { inFlight.current = false; setPending(false) } }
  }, [client, acceptSnapshot])
  const changeDirectory = async (path: string) => {
    if (!workspaceRef.current) throw new Error(s.waiting)
    directoryChanging.current = true; ++refreshCounter.current; setPending(true)
    try {
      acceptSnapshot(await client.setDirectory(path, workspaceRef.current))
      setFileTick(t => t + 1)
    } finally { directoryChanging.current = false; inFlight.current = false; setPending(false) }
  }
  const fileClient = useMemo<Client>(() => ({ ...client, file: (path, subpath) => client.file(path, subpath, snapshot?.workspaceId) }), [client, snapshot?.workspaceId])
  useEffect(() => {
    void refresh()
    return client.subscribe(() => { void refresh(); setFileTick(t => t + 1) })
  }, [client, refresh])
  const selection: Selection | undefined = snapshot?.board && snapshot.revision
    ? { workspaceId: snapshot.workspaceId, sessionId, board: snapshot.board, nodeIds: selected, edgeIds: [], revision: snapshot.revision } : undefined
  useEffect(() => {
    if (!selection || pending) return
    const save = () => { void client.selection(selection).catch(() => {}) }
    save(); const timer = setInterval(save, 30_000)
    return () => clearInterval(timer)
  }, [client, sessionId, snapshot?.workspaceId, snapshot?.board, snapshot?.revision, selected, pending])
  const choose = (board: string) => {
    if (directoryChanging.current) return
    setSelected([]); setError(''); void refresh(board, true)
    if (window.innerWidth < 700) setSidebar(false)
  }
  return <div className={'app-shell ' + (sidebar ? 'with-sidebar' : '')}>
    {sidebar && <aside className="sidebar">
      <div className="brand"><span className="brand-mark">▧</span><span>Better Canvas</span><button type="button" className="quiet-button" onClick={() => setSidebar(false)} aria-label={s.hide}>‹</button></div>
      <div className="vault-name" title={snapshot?.directory}>{snapshot?.directoryName ?? s.files}</div>
      <input className="file-search" type="search" placeholder={s.search} aria-label={s.search} value={query} onChange={e => setQuery(e.target.value)} />
      <nav className="file-list" aria-label={s.files}>
        {snapshot && <FolderTree key={snapshot.workspaceId} boards={snapshot.boards ?? []} active={snapshot.board} query={query} onChoose={choose} />}
      </nav>
      <div className="sidebar-footer"><span className="lock-symbol">◇</span>{s.readOnly}<small>v0.4</small></div>
    </aside>}
    <main className="main">
      <header className="topbar">
        {!sidebar && <button type="button" className="quiet-button sidebar-toggle" onClick={() => setSidebar(true)} aria-label={s.show}>☰</button>}
        <div className="breadcrumb"><span>▧</span><strong title={snapshot?.board}>{snapshot?.board?.split('/').pop()?.replace(/\.canvas$/, '') ?? 'Better Canvas'}</strong><span className="extension">.canvas</span></div>
        <span className="read-only-badge">{s.readOnly}</span>
        <button type="button" className="quiet-button settings-button" onClick={() => setSettings(true)} aria-label={s.settings} title={s.settings} disabled={!snapshot?.workspaceId}>⚙</button>
        <button type="button" className="quiet-button refresh-button" onClick={() => { void refresh(); setFileTick(t => t + 1) }} aria-label={s.refresh} title={s.refresh}>↻</button>
      </header>
      {error && <div className="error-banner" role="alert">{error}<button onClick={() => void refresh()}>{s.retry}</button></div>}
      <div className="canvas-stage">
        {snapshot?.data && snapshot.board ? <CanvasViewer key={snapshot.workspaceId + ':' + snapshot.board} client={fileClient} data={snapshot.data} selected={selected} onSelect={setSelected} refreshKey={fileTick} />
          : <div className="loading-state directory-empty"><span>{snapshot?.needsVault ? s.needsVault : snapshot ? s.noBoards : error ? s.error : s.loading}</span>{snapshot?.workspaceId && <button className="primary-button" onClick={() => setSettings(true)}>{s.chooseDirectory}</button>}</div>}
        {pending && <div className="switching-board">{s.loading}</div>}
      </div>
      <Composer key={(snapshot?.workspaceId ?? '') + ':' + (snapshot?.board ?? 'none')} client={client} cards={(snapshot?.data?.nodes ?? []).filter(n => selected.includes(n.id))}
        selection={selection} onRemove={id => setSelected(ids => ids.filter(i => i !== id))} onClear={() => setSelected([])} ready={!pending && !error} />
    </main>
    {settings && <DirectorySettings directory={snapshot?.directory ?? ''} onSave={changeDirectory} onClose={() => setSettings(false)} />}
  </div>
}
export function App() {
  const [client, setClient] = useState<Client>()
  const [error, setError] = useState('')
  useEffect(() => { void connectClient().then(setClient).catch(e => setError(e.message)) }, [])
  if (!client) return <div className="loading-state">{error || s.waiting}</div>
  return <AppWithClient client={client} />
}

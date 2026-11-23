import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { connectClient, type Client, type Selection, type Snapshot } from './client'
import { CanvasViewer } from './CanvasViewer'
import { Composer } from './Composer'
import { s } from './strings'
import { FolderTree } from './FolderTree'
import { DirectorySettings } from './DirectorySettings'
import type { CanvasNode, WriteIssue } from '@better-canvas/core'
import { Attachments } from './attachments'
import { WriteWarning } from './WriteWarning'

export function AppWithClient({ client }: { client: Client }) {
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [sidebar, setSidebar] = useState(window.innerWidth > 850)
  const [settings, setSettings] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [fileTick, setFileTick] = useState(0)
  const [fileVersions, setFileVersions] = useState<Record<string, number>>({})
  const [issue, setIssue] = useState<WriteIssue>()
  const [sessionId] = useState(() => crypto.randomUUID())
  const boardRef = useRef<string | undefined>(client.mode === 'browser' ? new URLSearchParams(location.search).get('board') ?? undefined : undefined), refreshCounter = useRef(0)
  const inFlight = useRef(false)
  const refreshQueued = useRef(false)
  const directoryChanging = useRef(false)
  const workspaceRef = useRef<string | undefined>(undefined)
  const latest = useRef<Snapshot | undefined>(undefined)
  const chosen = useRef(selected)
  const detached = useRef(new Map<string, CanvasNode>())
  chosen.current = selected
  const acceptSnapshot = useCallback((value: Snapshot) => {
    const changed = workspaceRef.current !== undefined && workspaceRef.current !== value.workspaceId
    if (changed || latest.current?.board !== value.board) {
      detached.current.clear(); setSelected([])
    } else if (chosen.current.length) {
      // Retain the exact chips the user selected. Submitting checks their IDs on disk.
      const current = new Set(value.data?.nodes?.map(n => n.id))
      const wanted = new Set(chosen.current.filter(id => !current.has(id)))
      for (const id of detached.current.keys()) if (!wanted.has(id)) detached.current.delete(id)
      for (const node of latest.current?.data?.nodes ?? []) if (wanted.has(node.id)) detached.current.set(node.id, node)
    } else detached.current.clear()
    latest.current = value
    workspaceRef.current = value.workspaceId
    boardRef.current = value.board
    setSnapshot(previous => previous && previous.workspaceId === value.workspaceId && previous.board === value.board && previous.revision === value.revision && JSON.stringify(previous.boards) === JSON.stringify(value.boards) ? previous : value)
    if (changed) { setQuery(''); setIssue(undefined) }
    if (client.mode === 'browser') {
      const url = new URL(location.href)
      if (value.board) url.searchParams.set('board', value.board); else url.searchParams.delete('board')
      history.replaceState(null, '', url)
    }
    setError('')
  }, [client])
  const refresh = useCallback(async (requested?: string, switchBoard = false) => {
    if (directoryChanging.current) return
    if (inFlight.current && !switchBoard) { refreshQueued.current = true; return }
    const token = ++refreshCounter.current
    if (switchBoard) { boardRef.current = requested; setPending(true) }
    inFlight.current = true
    try {
      const value = await client.preview(requested ?? boardRef.current, workspaceRef.current)
      if (token !== refreshCounter.current) return
      acceptSnapshot(value)
    } catch (e) {
      if (token === refreshCounter.current) {
        setError((e as Error).message)
      }
    } finally {
      if (token === refreshCounter.current) {
        inFlight.current = false; setPending(false)
        if (refreshQueued.current) { refreshQueued.current = false; void refresh() }
      }
    }
  }, [client, acceptSnapshot])
  const changeDirectory = async (path: string) => {
    if (!workspaceRef.current) throw new Error(s.waiting)
    directoryChanging.current = true; ++refreshCounter.current; setPending(true)
    try {
      acceptSnapshot(await client.setDirectory(path, workspaceRef.current))
      setFileTick(t => t + 1)
    } finally { directoryChanging.current = false; inFlight.current = false; setPending(false) }
  }
  const attachments = useMemo(() => new Attachments(client, snapshot?.workspaceId), [client, snapshot?.workspaceId, snapshot?.board])
  const fileClient = useMemo<Client>(() => ({ ...client, file: (path, subpath) => attachments.read(path, subpath) }), [client, attachments])
  const files = useRef(attachments)
  files.current = attachments
  useEffect(() => {
    const paths = new Set<string>()
    for (const n of snapshot?.data?.nodes ?? []) if (n.file ?? n.background) paths.add((n.file ?? n.background)!)
    attachments.retain(paths)
  }, [attachments, snapshot?.data])
  const reload = useCallback(() => { files.current.invalidate(); setFileTick(t => t + 1); void refresh() }, [refresh])
  const warn = useCallback((value: WriteIssue) => {
    setIssue(value)
    const removed = new Set(value.nodeIds)
    if (removed.size) setSelected(ids => ids.filter(id => !removed.has(id)))
    void refresh()
  }, [refresh])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const opening = latest.current
    if (!opening) return
    return client.subscribe(change => {
      if (change?.type === 'opened') {
        ++refreshCounter.current; inFlight.current = false; setPending(false)
        acceptSnapshot(change.snapshot); return
      }
      if (!change || change.type === 'directory_changed') { void refresh(); return }
      if (change.type === 'resync') { reload(); return }
      if (change.type === 'write_warning') {
        if (change.issue.path === boardRef.current || latest.current?.data?.nodes?.some(n => n.file === change.issue.path)) {
          warn(change.issue)
        }
        return
      }
      if (change.type === 'board_changed') {
        if (change.path === boardRef.current || !boardRef.current) void refresh()
        else if (change.exists !== undefined) {
          const previous = latest.current
          if (!previous) return
          const boards = previous.boards.filter(b => b.path !== change.path)
          if (change.exists && boards.length !== previous.boards.length) return
          if (change.exists) boards.push({ path: change.path, nodes: 0, edges: 0 })
          const next = { ...previous, boards }
          latest.current = next; setSnapshot(next)
        }
        return
      }
      if (change.type === 'file_changed') {
        const paths = files.current.invalidate(change.path)
        if (paths.size) setFileVersions(old => {
          const next = { ...old }; for (const path of paths) next[path] = (old[path] ?? 0) + 1
          return next
        })
      }
    }, { workspaceId: opening.workspaceId, cursor: opening.cursor, sessionId })
  }, [client, snapshot?.workspaceId, sessionId, acceptSnapshot, refresh, reload, warn])
  const displayedCards = new Map(detached.current)
  for (const node of snapshot?.data?.nodes ?? []) displayedCards.set(node.id, node)
  const selection: Selection | undefined = snapshot?.board && snapshot.revision
    ? { workspaceId: snapshot.workspaceId, sessionId, board: snapshot.board, nodeIds: selected, edgeIds: [], revision: snapshot.revision } : undefined
  useEffect(() => {
    if (!selection || pending) return
    void client.selection(selection).catch(() => {})
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
      <div className="sidebar-footer"><span className="lock-symbol">◇</span>{s.readOnly}<small>v0.4.1</small></div>
    </aside>}
    <main className="main">
      <header className="topbar">
        {!sidebar && <button type="button" className="quiet-button sidebar-toggle" onClick={() => setSidebar(true)} aria-label={s.show}>☰</button>}
        <div className="breadcrumb"><span>▧</span><strong title={snapshot?.board}>{snapshot?.board?.split('/').pop()?.replace(/\.canvas$/, '') ?? 'Better Canvas'}</strong><span className="extension">.canvas</span></div>
        <span className="read-only-badge">{s.readOnly}</span>
        <button type="button" className="quiet-button settings-button" onClick={() => setSettings(true)} aria-label={s.settings} title={s.settings} disabled={!snapshot?.workspaceId}>⚙</button>
        <button type="button" className="quiet-button refresh-button" onClick={reload} aria-label={s.refresh} title={s.refresh}>↻</button>
      </header>
      {error && <div className="error-banner" role="alert">{error}<button onClick={() => void refresh()}>{s.retry}</button></div>}
      <div className="canvas-stage">
        {snapshot?.data && snapshot.board ? <CanvasViewer key={snapshot.workspaceId + ':' + snapshot.board} client={fileClient} data={snapshot.data} selected={selected} onSelect={setSelected} refreshKey={fileTick} fileVersions={fileVersions} />
          : <div className="loading-state directory-empty"><span>{snapshot?.needsVault ? s.needsVault : snapshot ? s.noBoards : error ? s.error : s.loading}</span>{snapshot?.workspaceId && <button className="primary-button" onClick={() => setSettings(true)}>{s.chooseDirectory}</button>}</div>}
        {pending && <div className="switching-board">{s.loading}</div>}
      </div>
      <Composer key={(snapshot?.workspaceId ?? '') + ':' + (snapshot?.board ?? 'none')} client={client} cards={selected.map(id => displayedCards.get(id)).filter((n): n is CanvasNode => !!n)}
        selection={selection} onIssue={warn} onRemove={id => setSelected(ids => ids.filter(i => i !== id))} onClear={() => setSelected([])} ready={!pending && snapshot?.board === boardRef.current} />
    </main>
    {settings && <DirectorySettings directory={snapshot?.directory ?? ''} onSave={changeDirectory} onClose={() => setSettings(false)} />}
    {issue && <WriteWarning issue={issue} close={() => setIssue(undefined)} />}
  </div>
}
export function App() {
  const [client, setClient] = useState<Client>()
  const [error, setError] = useState('')
  useEffect(() => { void connectClient().then(setClient).catch(e => setError(e.message)) }, [])
  if (!client) return <div className="loading-state">{error || s.waiting}</div>
  return <AppWithClient client={client} />
}

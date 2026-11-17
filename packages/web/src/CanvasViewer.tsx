import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import type { CanvasData, CanvasNode } from '@better-canvas/core'
import type { Client, FilePreview } from './client'
import { color, edgeGeometry, fit, initialView, intersects, title, world, zoomAt, type Point, type Rect, type View } from './geometry'
import { Markdown } from './Markdown'
import { s } from './strings'

function FileCard({ node, client, refreshKey }: { node: CanvasNode; client: Client; refreshKey: number }) {
  const [file, setFile] = useState<FilePreview>()
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    void client.file(node.file ?? node.background ?? '', node.subpath).then(value => { if (live) { setFile(value); setError('') } }).catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [node.file, node.background, node.subpath, client, refreshKey])
  if (error) return <div className="file-error">{s.missing}<small>{node.file ?? node.background}</small></div>
  if (!file) return <div className="file-loading">{s.loading}</div>
  if (file.kind === 'image') return <img className="card-image" src={file.src} alt={node.file ?? ''} draggable={false} style={{ objectFit: node.type === 'group' && node.backgroundStyle === 'cover' ? 'cover' : 'contain' }} />
  if (file.kind === 'note') return <><div className="file-title">↗ {node.file?.split('/').pop()}{node.subpath}</div><Markdown text={file.text ?? ''} /></>
  return <div className="file-error">{node.file}<small>{s.unsupported}</small></div>
}
type Gesture = { mode: 'pan' | 'box'; start: Point; last: Point; view: View; additive: string[]; moved: boolean }
export function CanvasViewer({ data, client, selected, onSelect, refreshKey }: {
  data: CanvasData; client: Client; selected: string[]; onSelect(ids: string[]): void; refreshKey: number
}) {
  const root = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 })
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [box, setBox] = useState<Rect>()
  const gesture = useRef<Gesture | undefined>(undefined)
  const space = useRef(false)
  const initialized = useRef(false)
  const nodes = data.nodes ?? [], edges = data.edges ?? []
  const byId = new Map(nodes.map(n => [n.id, n]))
  const viewRef = useRef(view); viewRef.current = view
  useEffect(() => {
    const el = root.current!
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (initialized.current || size.width < 10 || !nodes.length) return
    initialized.current = true
    setView(initialView(nodes, size))
  }, [nodes, size])
  useEffect(() => {
    const el = root.current!
    function wheel(event: WheelEvent) {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      setView(v => event.ctrlKey || event.metaKey
        ? zoomAt(v, { x: event.clientX - rect.left, y: event.clientY - rect.top }, Math.exp(-event.deltaY * .006))
        : { ...v, x: v.x - (event.shiftKey ? event.deltaY : event.deltaX), y: v.y - (event.shiftKey ? event.deltaX : event.deltaY) })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])
  function point(e: PointerEvent) {
    const rect = root.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  function start(e: PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('button') || e.button === 2) return
    const node = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]')?.dataset.nodeId
    root.current?.focus({ preventScroll: true })
    e.preventDefault()
    if (node && !space.current && e.button === 0) {
      onSelect(e.shiftKey ? selected.includes(node) ? selected.filter(id => id !== node) : [...selected, node] : [node])
      return
    }
    if (e.button !== 0 && e.button !== 1) return
    const start = point(e)
    gesture.current = { mode: e.shiftKey && !space.current ? 'box' : 'pan', start, last: start, view: viewRef.current, additive: e.shiftKey ? selected : [], moved: false }
    root.current?.setPointerCapture(e.pointerId)
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current
    if (!g) return
    g.last = point(e)
    if (Math.hypot(g.last.x - g.start.x, g.last.y - g.start.y) > 4) g.moved = true
    if (g.mode === 'pan') setView({ ...g.view, x: g.view.x + g.last.x - g.start.x, y: g.view.y + g.last.y - g.start.y })
    else {
      const a = world(g.start, g.view), b = world(g.last, g.view)
      const rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
      setBox(rect)
      onSelect([...new Set([...g.additive, ...nodes.filter(n => n.type !== 'group' && intersects(n, rect)).map(n => n.id)])])
    }
  }
  function finish(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current
    if (g && !g.moved && g.mode === 'pan' && !space.current) onSelect([])
    gesture.current = undefined; setBox(undefined)
    if (root.current?.hasPointerCapture(e.pointerId)) root.current.releasePointerCapture(e.pointerId)
  }
  function zoom(factor: number) { setView(v => zoomAt(v, { x: size.width / 2, y: size.height / 2 }, factor)) }
  const focused = nodes.filter(n => selected.includes(n.id))
  return <div className="viewer" ref={root} tabIndex={0} aria-label="Canvas read-only view"
    onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}
    onBlur={() => { space.current = false }} onDragStart={e => e.preventDefault()} onDrop={e => e.preventDefault()} onDragOver={e => e.preventDefault()}
    onPaste={e => e.preventDefault()} onCut={e => e.preventDefault()}
    onContextMenu={e => e.preventDefault()}
    onKeyDown={e => {
      if (e.target !== root.current) return
      if (e.code === 'Space') { e.preventDefault(); space.current = true }
      if (e.key === 'Escape') onSelect([])
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); onSelect(nodes.filter(n => n.type !== 'group').map(n => n.id)) }
      if (['Delete', 'Backspace'].includes(e.key) || ((e.metaKey || e.ctrlKey) && ['v', 'x', 'z', 'y'].includes(e.key.toLowerCase()))) e.preventDefault()
      if (e.key === '0') setView(fit(nodes, size))
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(1.2) }
      if (e.key === '-') { e.preventDefault(); zoom(1 / 1.2) }
    }} onKeyUp={e => { if (e.code === 'Space') space.current = false }}>
    <div className="world" style={{ transform: 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.scale + ')' }}>
      <svg className="edge-layer" aria-hidden="true">
        {edges.map((edge, i) => {
          const from = byId.get(edge.fromNode), to = byId.get(edge.toNode)
          if (!from || !to) return null
          const shape = edgeGeometry(edge, from, to), stroke = color(edge.color), marker = 'arrow-' + i
          return <g key={edge.id}>
            <defs><marker id={marker} markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M 0 0 L 9 5 L 0 10" fill="none" stroke={stroke} strokeWidth="1.8" /></marker></defs>
            <path d={shape.path} fill="none" stroke={stroke} strokeWidth="2" markerStart={edge.fromEnd === 'arrow' ? 'url(#' + marker + ')' : undefined} markerEnd={(edge.toEnd ?? 'arrow') === 'arrow' ? 'url(#' + marker + ')' : undefined} />
            {edge.label && <text x={shape.label.x} y={shape.label.y} className="edge-label">{edge.label}</text>}
          </g>
        })}
      </svg>
      {nodes.map((node, i) => <div key={node.id} id={'canvas-node-' + node.id} data-node-id={node.id}
        className={'canvas-card ' + (node.type === 'group' ? 'group-card ' : '') + (selected.includes(node.id) ? 'selected' : '')}
        role="option" aria-selected={selected.includes(node.id)} aria-label={title(node)}
        style={{ left: node.x, top: node.y, width: node.width, height: node.height, zIndex: i + 1, '--card-color': color(node.color) } as CSSProperties}>
        {node.type === 'group' ? <>{node.background && <div className="group-background"><FileCard node={node} client={client} refreshKey={refreshKey} /></div>}<div className="group-label">{node.label ?? 'Group'}</div></>
          : <div className="card-body">
            {node.type === 'text' ? <Markdown text={node.text ?? ''} />
              : node.type === 'file' ? <FileCard node={node} client={client} refreshKey={refreshKey} />
              : node.type === 'link' ? <div className="link-card"><span>↗</span><strong>{node.url ?? ''}</strong><small>Link</small></div>
              : <div className="file-error">{node.type}<small>{s.unsupported}</small></div>}
          </div>}
      </div>)}
      {box && <div className="selection-box" style={{ left: box.x, top: box.y, width: box.width, height: box.height }} />}
    </div>
    {!nodes.length && <div className="empty-canvas">{s.noBoards}</div>}
    <div className="canvas-controls" onPointerDown={e => e.stopPropagation()}>
      <button type="button" onClick={() => zoom(1 / 1.2)} title={s.zoomOut} aria-label={s.zoomOut}>−</button>
      <button type="button" className="zoom-value" title={s.normal} onClick={() => setView(v => zoomAt(v, { x: size.width / 2, y: size.height / 2 }, 1 / v.scale))}>{Math.round(view.scale * 100)}%</button>
      <button type="button" onClick={() => zoom(1.2)} title={s.zoomIn} aria-label={s.zoomIn}>+</button>
      <i />
      <button type="button" onClick={() => setView(fit(focused.length ? focused : nodes, size))} title={s.focus} aria-label={s.focus}>⌖</button>
      <button type="button" onClick={() => setView(fit(nodes, size))} title={s.fit}>{s.fit}</button>
    </div>
    <div className="gesture-hint">{s.help}</div>
  </div>
}

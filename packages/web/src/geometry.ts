import type { CanvasNode, CanvasEdge, Side } from '@better-canvas/core'
export interface Point { x: number; y: number }
export interface View extends Point { scale: number }
export interface Rect extends Point { width: number; height: number }
export function bounds(nodes: CanvasNode[]): Rect {
  if (!nodes.length) return { x: 0, y: 0, width: 800, height: 500 }
  const x = Math.min(...nodes.map(n => n.x)), y = Math.min(...nodes.map(n => n.y))
  return { x, y, width: Math.max(...nodes.map(n => n.x + n.width)) - x, height: Math.max(...nodes.map(n => n.y + n.height)) - y }
}
export function fit(nodes: CanvasNode[], size: { width: number; height: number }): View {
  const box = bounds(nodes), pad = 70
  const scale = Math.max(.04, Math.min(1, (size.width - pad * 2) / box.width, (size.height - pad * 2) / box.height))
  return { x: (size.width - box.width * scale) / 2 - box.x * scale, y: (size.height - box.height * scale) / 2 - box.y * scale, scale }
}
export function initialView(nodes: CanvasNode[], size: { width: number; height: number }): View {
  const all = fit(nodes, size)
  if (all.scale >= .45 || !nodes.length) return all
  const cards = nodes.filter(n => n.type !== 'group')
  if (!cards.length) return all
  const centers = cards.map(n => n.x + n.width / 2).sort((a,b) => a-b)
  const middle = centers[Math.floor(centers.length / 2)]!
  const top = Math.min(...cards.map(n => n.y))
  const first = cards.filter(n => n.y <= top + 200).sort((a,b) =>
    Math.abs(a.x + a.width / 2 - middle) - Math.abs(b.x + b.width / 2 - middle) || a.y - b.y)[0]!
  const scale = Math.max(.04, Math.min(.85, (size.width - 100) / Math.max(first.width, 450)))
  return { x: size.width / 2 - (first.x + first.width / 2) * scale, y: 64 - first.y * scale, scale }
}
export function world(point: Point, view: View): Point { return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale } }
export function zoomAt(view: View, point: Point, factor: number): View {
  const scale = Math.min(2.5, Math.max(.04, view.scale * factor))
  const p = world(point, view)
  return { x: point.x - p.x * scale, y: point.y - p.y * scale, scale }
}
export function intersects(a: Rect, b: Rect) { return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y }
const vectors: Record<Side, Point> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }
function anchor(node: CanvasNode, side: Side): Point {
  return { x: node.x + (side === 'left' ? 0 : side === 'right' ? node.width : node.width / 2),
    y: node.y + (side === 'top' ? 0 : side === 'bottom' ? node.height : node.height / 2) }
}
export function edgeGeometry(edge: CanvasEdge, from: CanvasNode, to: CanvasNode) {
  const dx = to.x + to.width / 2 - from.x - from.width / 2
  const dy = to.y + to.height / 2 - from.y - from.height / 2
  const fromSide = edge.fromSide ?? (Math.abs(dx) > Math.abs(dy) ? dx >= 0 ? 'right' : 'left' : dy >= 0 ? 'bottom' : 'top')
  const toSide = edge.toSide ?? ({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const)[fromSide]
  const a = anchor(from, fromSide), b = anchor(to, toSide)
  const distance = Math.max(45, Math.min(240, Math.hypot(b.x - a.x, b.y - a.y) * .5))
  const c = { x: a.x + vectors[fromSide].x * distance, y: a.y + vectors[fromSide].y * distance }
  const d = { x: b.x + vectors[toSide].x * distance, y: b.y + vectors[toSide].y * distance }
  return { path: 'M ' + a.x + ' ' + a.y + ' C ' + c.x + ' ' + c.y + ', ' + d.x + ' ' + d.y + ', ' + b.x + ' ' + b.y,
    label: { x: (a.x + 3 * c.x + 3 * d.x + b.x) / 8, y: (a.y + 3 * c.y + 3 * d.y + b.y) / 8 } }
}
export function title(node: CanvasNode): string {
  const text = node.label ?? node.file?.split('/').pop() ?? node.url ?? node.text?.split('\n').find(s => s.trim()) ?? node.id
  return text.replace(/^#+\s*/, '').replace(/[*_\x60]/g, '').slice(0, 60)
}
export function color(value?: string): string {
  return ({ '1': '#c75b59', '2': '#c68a46', '3': '#b29a40', '4': '#529b69', '5': '#4b9da5', '6': '#916bc4' } as Record<string, string>)[value ?? '']
    ?? (/^#[\da-f]{6}$/i.test(value ?? '') ? value! : '#a8a6af')
}

import type { CanvasData, CanvasNode, CanvasEdge } from './types.ts'
export type Operation =
  | { op: 'update_node'; id: string; patch: Record<string, unknown> }
  | { op: 'add_node'; node: CanvasNode }
  | { op: 'delete_node'; id: string }
  | { op: 'update_edge'; id: string; patch: Record<string, unknown> }
  | { op: 'add_edge'; edge: CanvasEdge }
  | { op: 'delete_edge'; id: string }
function patchRecord(target: Record<string, unknown>, patch: Record<string, unknown>) {
  for (const [key, value] of Object.entries(patch)) {
    if (['__proto__', 'constructor', 'prototype', 'id'].includes(key)) throw new Error('IDs and prototype properties cannot be patched.')
    if (value === null) delete target[key]
    else target[key] = value
  }
}
export function validateCanvas(data: CanvasData): void {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid Canvas document.')
  if (data.nodes !== undefined && !Array.isArray(data.nodes)) throw new Error('nodes must be an array.')
  if (data.edges !== undefined && !Array.isArray(data.edges)) throw new Error('edges must be an array.')
  const ids = new Set<string>()
  for (const n of data.nodes ?? []) {
    if (!n || typeof n.id !== 'string' || !n.id || ids.has(n.id)) throw new Error('Invalid or duplicate node ID.')
    ids.add(n.id)
    if (typeof n.type !== 'string' || !n.type) throw new Error('A node needs a type.')
    if (![n.x, n.y, n.width, n.height].every(Number.isFinite) || n.width <= 0 || n.height <= 0) throw new Error('Invalid node geometry.')
    for (const key of ['text', 'label', 'file', 'subpath', 'url', 'color', 'background', 'backgroundStyle']) {
      if (n[key] !== undefined && typeof n[key] !== 'string') throw new Error('Invalid node field: ' + key)
    }
  }
  const edgeIds = new Set<string>()
  for (const e of data.edges ?? []) {
    if (!e || typeof e.id !== 'string' || !e.id || edgeIds.has(e.id)) throw new Error('Invalid or duplicate edge ID.')
    edgeIds.add(e.id)
    if (!ids.has(e.fromNode) || !ids.has(e.toNode)) throw new Error('Edge endpoint does not exist.')
    for (const key of ['fromSide', 'toSide'] as const) {
      if (e[key] !== undefined && !['top', 'right', 'bottom', 'left'].includes(e[key]!)) throw new Error('Invalid edge side.')
    }
    for (const key of ['fromEnd', 'toEnd'] as const) {
      if (e[key] !== undefined && !['arrow', 'none'].includes(e[key]!)) throw new Error('Invalid edge end.')
    }
    if (e.label !== undefined && typeof e.label !== 'string') throw new Error('Invalid edge label.')
    if (e.color !== undefined && typeof e.color !== 'string') throw new Error('Invalid edge color.')
  }
}
/** All-or-nothing plan. Geometry changes only when explicitly requested. */
export function applyOps(original: CanvasData, operations: Operation[]): CanvasData {
  const data = structuredClone(original)
  data.nodes ??= []; data.edges ??= []
  for (const op of operations) {
    if (op.op === 'add_node') {
      if (data.nodes.some(n => n.id === op.node.id)) throw new Error('Node ID already exists.')
      data.nodes.push(structuredClone(op.node))
    } else if (op.op === 'add_edge') {
      if (data.edges.some(e => e.id === op.edge.id)) throw new Error('Edge ID already exists.')
      data.edges.push(structuredClone(op.edge))
    } else if (op.op === 'update_node') {
      const node = data.nodes.find(n => n.id === op.id)
      if (!node) throw new Error('Unknown node: ' + op.id)
      patchRecord(node, op.patch)
    } else if (op.op === 'update_edge') {
      const edge = data.edges.find(e => e.id === op.id)
      if (!edge) throw new Error('Unknown edge: ' + op.id)
      patchRecord(edge, op.patch)
    } else if (op.op === 'delete_node') {
      if (!data.nodes.some(n => n.id === op.id)) throw new Error('Unknown node: ' + op.id)
      data.nodes = data.nodes.filter(n => n.id !== op.id)
      data.edges = data.edges.filter(e => e.fromNode !== op.id && e.toNode !== op.id)
    } else if (op.op === 'delete_edge') {
      if (!data.edges.some(e => e.id === op.id)) throw new Error('Unknown edge: ' + op.id)
      data.edges = data.edges.filter(e => e.id !== op.id)
    } else throw new Error('Unknown operation.')
  }
  validateCanvas(data)
  return data
}

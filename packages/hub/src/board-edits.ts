import { isDeepStrictEqual as equal } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { applyOps, type CanvasData, type Operation } from '@better-canvas/core'
import { readBoard, writeBoard } from './boards.ts'
import { ConflictError } from './storage.ts'

function checkTouchedFields(base: CanvasData, latest: CanvasData, ops: Operation[]) {
  for (const op of ops) {
    if (op.op === 'add_node' || op.op === 'add_edge') continue
    const isNode = op.op === 'update_node' || op.op === 'delete_node'
    const before = (isNode ? base.nodes : base.edges)?.find(item => item.id === op.id)
    const now = (isNode ? latest.nodes : latest.edges)?.find(item => item.id === op.id)
    if (op.op === 'delete_node' || op.op === 'delete_edge') {
      if (!equal(before, now)) throw new ConflictError()
      if (op.op === 'delete_node') {
        const attached = (board: CanvasData) => board.edges?.filter(e => e.fromNode === op.id || e.toNode === op.id) ?? []
        if (!equal(attached(base), attached(latest))) throw new ConflictError()
      }
    } else {
      if (!!before !== !!now || (isNode && before?.type !== now?.type)) throw new ConflictError()
      for (const [key, value] of Object.entries(op.patch)) {
        if (!equal(before?.[key], now?.[key]) && !equal(now?.[key], value === null ? undefined : value)) throw new ConflictError()
      }
    }
  }
}

/** Keep a bounded set of observed revisions. An unknown base still requires a fresh read. */
export class BoardEdits {
  private seen = new Map<string, CanvasData>()
  remember(root: string, board: string, revision: string, data: CanvasData) {
    const key = JSON.stringify([root, board, revision])
    this.seen.delete(key)
    this.seen.set(key, data)
    if (this.seen.size > 24) this.seen.delete(this.seen.keys().next().value!)
  }
  async apply(root: string, board: string, revision: string, ops: Operation[], checkReference?: (data: CanvasData) => void) {
    let base = this.seen.get(JSON.stringify([root, board, revision]))
    for (let attempt = 0; ; attempt++) {
      try {
        const latest = await readBoard(root, board)
        checkReference?.(latest.data)
        // Missing targets invalidate the entire batch, even if its base has expired.
        const next = applyOps(latest.data, ops)
        if (revision === latest.revision) base = latest.data
        else {
          if (!base) throw new ConflictError()
          checkTouchedFields(base, latest.data, ops)
        }
        try {
          const saved = await writeBoard(root, board, next, latest.style, latest.revision)
          this.remember(root, board, saved, next)
          return { board, revision: saved, operations: ops.length, rebased: latest.revision !== revision }
        } catch (e) {
          if (!(e instanceof ConflictError) || attempt >= 3) throw e
          // A writer won the race after our read. Rebuild only these operations on its bytes.
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT' || attempt >= 3) throw e
      }
      // Some editors briefly remove the original path while saving.
      await delay(35 * (attempt + 1))
    }
  }
}

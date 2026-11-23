import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ChangeBatch, PanelChange, WriteIssue } from '@better-canvas/core'
import { revisionOf } from './storage.ts'
import { watchRoot } from './watch.ts'
import type { Workspace } from './workspace.ts'

/** Both transports resume from the cursor captured before the opening snapshot. */
export class PanelEvents {
  private readonly workspace: Workspace
  private readonly epoch = randomUUID()
  private sequence = 0
  private history: PanelChange[] = []
  private noticeIds = new Set<string>()
  private listeners = new Set<() => void>()
  private sessions = new Map<string, number>()
  private watcher?: ReturnType<typeof watchRoot>
  private unsubscribe?: () => void
  constructor(workspace: Workspace) { this.workspace = workspace }

  get cursor() { return this.epoch + ':' + this.sequence }
  isOpen(session: string) { return (this.sessions.get(session) ?? 0) > Date.now() }
  present(session: string, until: number) {
    for (const [id, end] of this.sessions) if (end <= Date.now()) this.sessions.delete(id)
    if (until) this.sessions.set(session, until)
    else this.sessions.delete(session)
  }
  start() {
    if (!this.unsubscribe) {
      this.attach()
      this.unsubscribe = this.workspace.subscribe(() => {
        this.attach()
        this.sessions.clear()
        this.publish({ type: 'directory_changed' })
      })
    }
    return this.cursor
  }
  private attach() {
    this.watcher?.close()
    this.watcher = undefined
    if (this.workspace.root) {
      try {
        const root = this.workspace.root
        this.watcher = watchRoot(root, ({ type, board }) => {
          if (type === 'notice') { void this.readNotice(root, board); return }
          this.publish(type === 'canvas' ? { type: 'board_changed', path: board, exists: existsSync(path.join(root, board)) } : { type: 'file_changed', path: board })
        })
      } catch { /* Manual refresh and pre-write checks still work without an OS watcher. */ }
    }
  }
  private notice(id: string, issue: WriteIssue, sessionId?: string) {
    if (this.noticeIds.has(id)) return
    this.noticeIds.add(id)
    if (this.noticeIds.size > 128) this.noticeIds.delete(this.noticeIds.values().next().value!)
    this.publish({ type: 'write_warning', issue, sessionId })
  }
  async warn(issue: WriteIssue, sessionId?: string) {
    const id = randomUUID(), root = this.workspace.root
    this.notice(id, issue, sessionId)
    // A desktop may run the widget and model through different stdio processes.
    // Keep only the latest notice for each board/session, outside the user's content.
    const dir = path.join(root, '.better-canvas', 'notices')
    try {
      await mkdir(dir, { recursive: true })
      if (await realpath(dir) !== dir) return
      const file = path.join(dir, revisionOf(JSON.stringify([issue.path, sessionId])) + '.json')
      const temp = file + '.' + id + '.tmp'
      await writeFile(temp, JSON.stringify({ id, issue, sessionId }))
      await rename(temp, file)
    } catch { /* The originating caller still receives the structured error. */ }
  }
  private async readNotice(root: string, rel: string) {
    try {
      const name = path.join(root, rel)
      if (await realpath(name) !== name) return
      const { id, issue, sessionId } = JSON.parse(await readFile(name, 'utf8'))
      if (root === this.workspace.root && typeof id === 'string' && typeof issue?.path === 'string'
        && ['missing_file', 'missing_targets'].includes(issue.code)
        && [issue.nodeIds, issue.edgeIds].every(a => Array.isArray(a) && a.every(k => typeof k === 'string')))
        this.notice(id, issue, sessionId)
    } catch { /* A superseded or invalid warning has no effect on content. */ }
  }
  saved(rel: string) {
    if (this.watcher) this.watcher.changed(rel)
    else this.publish(rel.endsWith('.canvas') ? { type: 'board_changed', path: rel, exists: true } : { type: 'file_changed', path: rel })
  }
  publish(change: PanelChange) {
    this.sequence++
    this.history.push(change)
    if (this.history.length > 128) this.history.shift()
    for (const notify of this.listeners) notify()
  }
  since(cursor: string): ChangeBatch {
    const [epoch, value] = cursor.split(':')
    const count = this.sequence - Number(value)
    if (epoch !== this.epoch || !Number.isSafeInteger(count) || count < 0 || count > this.history.length)
      return { cursor: this.cursor, changes: [{ type: 'resync' }] }
    return { cursor: this.cursor, changes: count ? this.history.slice(-count) : [] }
  }
  onChange(notify: () => void) {
    this.listeners.add(notify)
    return () => { this.listeners.delete(notify) }
  }
  async wait(cursor: string, signal: AbortSignal): Promise<ChangeBatch> {
    const current = this.since(cursor)
    if (current.changes.length || signal.aborted) return current
    // The host limits tool-call duration. Renewing a quiet listener never reads the vault.
    return new Promise(resolve => {
      const finish = () => {
        clearTimeout(timer)
        this.listeners.delete(finish)
        signal.removeEventListener('abort', finish)
        resolve(this.since(cursor))
      }
      const timer = setTimeout(finish, 40_000)
      this.listeners.add(finish)
      signal.addEventListener('abort', finish, { once: true })
    })
  }
  close() {
    this.unsubscribe?.()
    this.watcher?.close()
    this.unsubscribe = undefined
    for (const notify of this.listeners) notify()
    this.listeners.clear()
  }
}

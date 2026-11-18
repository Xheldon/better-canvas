import { realpathSync, statSync } from 'node:fs'
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { revisionOf } from './storage.ts'

export const defaultSettingsPath = () => process.env.BETTER_CANVAS_SETTINGS ?? path.join(homedir(), '.config', 'better-canvas', 'settings.json')
export const workspaceId = (root: string) => revisionOf(root)

export class Workspace {
  root = ''
  readonly settingsPath?: string
  private listeners = new Set<() => void>()
  private pending: Promise<unknown> = Promise.resolve()
  constructor(initialRoot = '', settingsPath?: string) {
    this.settingsPath = settingsPath
    if (initialRoot) {
      this.root = realpathSync(initialRoot)
      if (!statSync(this.root).isDirectory()) throw new Error('Choose a directory.')
    }
  }
  get id() { return workspaceId(this.root) }
  info() { return { workspaceId: this.id, directory: this.root, directoryName: this.root ? path.basename(this.root) : undefined } }
  requireRoot() { if (!this.root) throw new Error('Choose a working directory in Settings, or call open_vault with the folder provided by the user.'); return this.root }
  assertScope(expected: string) {
    if (expected !== this.id) throw new Error('The working directory changed. Refresh and read the current file before continuing.')
  }
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const next = this.pending.then(action, action)
    this.pending = next.catch(() => {})
    return next
  }
  scoped<T>(expected: string, action: (root: string) => Promise<T>) {
    return this.exclusive(async () => {
      this.assertScope(expected)
      return action(this.requireRoot())
    })
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  async restore() {
    if (!this.settingsPath || this.root) return
    try {
      const saved = JSON.parse(await readFile(this.settingsPath, 'utf8'))
      if (typeof saved.directory === 'string' && path.isAbsolute(saved.directory)) {
        const root = await realpath(saved.directory)
        if ((await stat(root)).isDirectory()) this.root = root
      }
    } catch { /* A removed folder or invalid config returns to the directory chooser. */ }
  }
  select(input: string, expected?: string) {
    return this.exclusive(() => this.change(input, expected))
  }
  private async change(input: string, expected?: string) {
    if (expected !== undefined) this.assertScope(expected)
    if (typeof input !== 'string' || !input.trim()) throw new Error('Enter a directory path.')
    const selected = input.trim().startsWith('~/') ? path.join(homedir(), input.trim().slice(2)) : input.trim()
    if (!path.isAbsolute(selected)) throw new Error('Use an absolute directory path, or ~/ on macOS/Linux.')
    const next = await realpath(selected)
    if (!(await stat(next)).isDirectory()) throw new Error('Choose a directory, not a file.')
    if (this.settingsPath) {
      await mkdir(path.dirname(this.settingsPath), { recursive: true })
      const temporary = this.settingsPath + '.' + randomUUID() + '.tmp'
      await writeFile(temporary, JSON.stringify({ directory: next }, null, 2) + '\n', { mode: 0o600 })
      await rename(temporary, this.settingsPath)
    }
    if (next !== this.root) {
      this.root = next
      for (const listener of this.listeners) listener()
    }
    return this.info()
  }
}

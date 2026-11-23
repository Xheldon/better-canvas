import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export const revisionOf = (text: string | Buffer) => createHash('sha256').update(text).digest('hex')

export class ConflictError extends Error {
  readonly status = 409
  constructor() { super('The file changed since it was read. Your edit was not applied. Reload, compare your draft, and retry.') }
}

export async function readForWrite<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await read() }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT' || attempt >= 3) throw e
      await delay(35 * (attempt + 1))
    }
  }
}

/** Reject hidden paths and symlink escapes, including a symlinked parent of a new file. */
export async function vaultPath(root: string, rel: string): Promise<string> {
  if (!rel || path.isAbsolute(rel) || rel.split(/[/\\]/).some(p => p.startsWith('.')) || rel.includes('\\')) {
    throw new Error('Use a visible, vault-relative file path.')
  }
  const base = await realpath(root)
  const target = path.resolve(base, rel)
  if (!target.startsWith(base + path.sep)) throw new Error('Path escapes the vault.')
  let existing = target
  while (true) {
    try {
      const resolved = await realpath(existing)
      if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new Error('Symlink escapes the vault.')
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      existing = path.dirname(existing)
    }
  }
  return target
}

/** Serialize Better Canvas writers across its HTTP and MCP processes. */
export async function withFileLock<T>(root: string, rel: string, fn: () => Promise<T>): Promise<T> {
  const dir = path.join(root, '.better-canvas', 'locks')
  await mkdir(dir, { recursive: true })
  const lock = path.join(dir, revisionOf(rel))
  const deadline = Date.now() + 5000
  let handle
  while (!handle) {
    try { handle = await open(lock, 'wx') } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      if (Date.now() > deadline) throw new Error('File is busy. Retry shortly; a stale lock can be removed after stopping all Better Canvas processes.')
      await delay(30)
    }
  }
  try { return await fn() } finally { await handle.close(); await rm(lock, { force: true }) }
}

/** Compare immediately before replacing; keep the previous bytes for recovery. */
export async function writeVersioned(root: string, rel: string, next: string, expected?: string): Promise<string> {
  return withFileLock(root, rel, async () => {
    const abs = await vaultPath(root, rel)
    let previous: string | undefined
    try { previous = await readFile(abs, 'utf8') } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    if (expected !== undefined && (previous === undefined || revisionOf(previous) !== expected)) throw new ConflictError()
    if (previous === next) return revisionOf(next)
    if (previous !== undefined) {
      const history = path.join(root, '.better-canvas', 'history', revisionOf(rel))
      await mkdir(history, { recursive: true })
      await writeFile(path.join(history, `${revisionOf(previous)}.json`), JSON.stringify({ path: rel, savedAt: new Date().toISOString(), text: previous }))
    }
    const tmp = `${abs}.${randomUUID()}.tmp`
    try {
      await writeFile(tmp, next, 'utf8')
      // Obsidian does not take our lock. Detect edits that occurred during backup/write.
      if (previous !== undefined && revisionOf(await readFile(abs, 'utf8')) !== revisionOf(previous)) throw new ConflictError()
      if (previous === undefined) {
        // Exclusive creation cannot overwrite a file created by another editor.
        const created = await open(abs, 'wx')
        try { await created.writeFile(next, 'utf8') } finally { await created.close() }
      } else await rename(tmp, abs)
      return revisionOf(next)
    } finally { await rm(tmp, { force: true }) }
  })
}

export async function readNote(root: string, rel: string, subpath?: string) {
  if (!/\.(md|markdown|txt)$/i.test(rel)) throw new Error('Only Markdown and text notes are supported.')
  const abs = await vaultPath(root, rel)
  if ((await stat(abs)).size > 2 * 1024 * 1024) throw new Error('Note is too large (2 MB limit).')
  const text = await readFile(abs, 'utf8')
  return { path: rel, subpath, text: excerpt(text, subpath), revision: revisionOf(text), isExcerpt: !!subpath }
}

export function excerpt(text: string, subpath?: string): string {
  if (!subpath) return text
  let anchor: string
  try { anchor = decodeURIComponent(subpath.replace(/^#/, '')) } catch { anchor = subpath.replace(/^#/, '') }
  const lines = text.split('\n')
  if (anchor.startsWith('^')) {
    const id = anchor.slice(1)
    const index = lines.findIndex(l => l.trimEnd().endsWith(`^${id}`))
    if (index < 0) throw new Error(`Block not found: ${subpath}`)
    let start = index
    if (!lines[index]!.trim().startsWith('^')) {
      while (start > 0 && lines[start - 1]!.trim()) start--
    } else {
      start--
      while (start >= 0 && !lines[start]!.trim()) start--
      while (start > 0 && lines[start - 1]!.trim()) start--
    }
    return lines.slice(Math.max(0, start), index + 1).join('\n').replace(new RegExp(`\\s*\\^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`), '')
  }
  let fence = false
  let start = -1
  let level = 0
  let end = lines.length
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue }
    if (fence) continue
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (!heading) continue
    if (start >= 0 && heading[1]!.length <= level) { end = i; break }
    if (start < 0 && heading[2]!.trim().toLocaleLowerCase() === anchor.toLocaleLowerCase()) { start = i; level = heading[1]!.length }
  }
  if (start < 0) throw new Error(`Heading not found: ${subpath}`)
  return lines.slice(start, end).join('\n').trimEnd()
}

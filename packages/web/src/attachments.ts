import type { Client, FilePreview } from './client'

/** One cache per open board. A shared image, or two cards for a note excerpt, load once. */
export class Attachments {
  private entries = new Map<string, { path: string; watchPath?: string; value: Promise<FilePreview> }>()
  private client: Client
  private workspaceId?: string
  constructor(client: Client, workspaceId?: string) { this.client = client; this.workspaceId = workspaceId }
  read(path: string, subpath?: string) {
    const key = JSON.stringify([path, subpath])
    const existing = this.entries.get(key)
    if (existing) return existing.value
    const entry = { path, watchPath: undefined as string | undefined,
      value: this.client.file(path, subpath, this.workspaceId).then(file => { entry.watchPath = file.watchPath; return file }) }
    this.entries.set(key, entry)
    return entry.value
  }
  invalidate(path?: string) {
    const affected = new Set<string>()
    for (const [key, entry] of this.entries) {
      if (!path || entry.path === path || entry.watchPath === path) {
        this.entries.delete(key)
        affected.add(entry.path)
      }
    }
    return affected
  }
  retain(paths: Set<string>) {
    for (const [key, entry] of this.entries) if (!paths.has(entry.path)) this.entries.delete(key)
  }
}

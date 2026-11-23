import { watch } from 'node:fs'
export interface WatchSignal { type: 'canvas' | 'file' | 'notice'; board: string }
export function watchRoot(root: string, onSignal: (signal: WatchSignal) => void) {
  const timers = new Map<string, NodeJS.Timeout>()
  function changed(name: string) {
    if (!name) return
    const rel = name.split('\\').join('/')
    const isNotice = /^\.better-canvas\/notices\/[a-f0-9]{64}\.json$/.test(rel)
    if (!isNotice && (rel.split('/').some(s => s.startsWith('.') || ['node_modules', 'dist', 'build', 'coverage'].includes(s)) || rel.endsWith('.tmp'))) return
    clearTimeout(timers.get(rel))
    timers.set(rel, setTimeout(() => {
      timers.delete(rel)
      onSignal({ type: isNotice ? 'notice' : rel.endsWith('.canvas') ? 'canvas' : 'file', board: rel })
    }, 160))
  }
  const watcher = watch(root, { recursive: true }, (_event, name) => { if (name) changed(name) })
  // An unavailable OS watcher must not crash the stdio server. Explicit MCP saves still signal.
  watcher.on('error', () => watcher.close())
  return { changed, close() { watcher.close(); for (const timer of timers.values()) clearTimeout(timer); timers.clear() } }
}

import { watch } from 'node:fs'
export interface WatchSignal { type: 'canvas' | 'file'; board: string }
export function watchRoot(root: string, onSignal: (signal: WatchSignal) => void) {
  const timers = new Map<string, NodeJS.Timeout>()
  const watcher = watch(root, { recursive: true }, (_event, name) => {
    if (!name) return
    const rel = name.split('\\').join('/')
    if (rel.split('/').some(s => s.startsWith('.') || ['node_modules', 'dist', 'build', 'coverage'].includes(s)) || rel.endsWith('.tmp')) return
    clearTimeout(timers.get(rel))
    timers.set(rel, setTimeout(() => {
      timers.delete(rel)
      onSignal({ type: rel.endsWith('.canvas') ? 'canvas' : 'file', board: rel })
    }, 160))
  })
  return { close() { watcher.close(); for (const timer of timers.values()) clearTimeout(timer); timers.clear() } }
}

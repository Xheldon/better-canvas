#!/usr/bin/env node
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createHubServer } from './server.ts'
import { startServe } from './serve.ts'
import { Workspace, defaultSettingsPath } from './workspace.ts'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  console.log('Better Canvas — read-only preview, AI editing over MCP\n\n  better-canvas mcp\n  better-canvas mcp --root <directory>\n  better-canvas serve [--root <directory>] [--port 5199]\n\nChoose a working directory in Settings. The choice is remembered locally.\n--select-vault remains a compatibility alias for restoring the saved choice.\nThe browser never edits files. The integrated composer requires an MCP Apps host.\nNo agents are spawned and no telemetry is sent.')
  process.exit(0)
}
function flag(name: string) {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const value = args[i + 1]
  if (!value || value.startsWith('--')) throw new Error(name + ' needs a value.')
  return value
}
const here = fileURLToPath(new URL('.', import.meta.url))
const webDist = [path.join(here, 'web'), path.join(here, '../../web/dist')].find(p => existsSync(path.join(p, 'index.html')))
const workspace = new Workspace('', defaultSettingsPath())
const selected = flag('--root')
if (selected) await workspace.select(selected)
else await workspace.restore()
const command = args[0] && !args[0].startsWith('--') ? args[0] : 'mcp'
if (command === 'serve') {
  const port = Number(flag('--port') ?? 5199)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port.')
  const running = await startServe(workspace, { port, webDist })
  console.error('Read-only preview: http://127.0.0.1:' + running.port + '/')
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void running.close().then(() => process.exit(0)) })
} else if (command === 'mcp') {
  await createHubServer(workspace, webDist).connect(new StdioServerTransport())
} else throw new Error('Unknown command. Use --help.')

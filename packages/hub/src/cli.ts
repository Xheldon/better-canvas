#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createHubServer } from './server.ts'
import { startServe } from './serve.ts'
import { createReporter, errorDetail } from './report.ts'

const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  console.log(`better-canvas — local Obsidian Canvas editor with MCP

usage:
  better-canvas mcp --select-vault                        choose a vault with the open_vault tool
  better-canvas serve [--root] [--port] [--host] [--token]       HTTP + WebSocket server for the web client
  better-canvas mcp [--root <path>]                              MCP server on stdio (for agent harnesses; also the default)

options:
  --root <path>    vault folder to serve (default: cwd)
  --port <n>       serve mode port (default: 5199)
  --host <addr>    bind address (default: 127.0.0.1 — local only).
                   Use 0.0.0.0 to reach it over a VPN/LAN; pair it with --token.
  --token <secret> require a bearer token (or ?token=) on /api and /ws
  --agent-cmd <t>  command for the handoff button; the prompt is piped to
                   stdin, or replaces a {prompt} placeholder if present
                   (default: 'claude -p --mcp-config .mcp.json --allowedTools mcp__better-canvas')
  --handoff-mode <m>  'spawn' runs a fresh agent turn per handoff;
                   'signal' (default) only broadcasts handoff_requested on /ws, for a
                   long-running session listening with its own context
  --handoff-timeout <s>  kill a spawned agent turn after this many seconds
                   (default: 300)
  --autocommit     commit every board change to the root's git repo
                   (run 'git init' in the root first)
  --report-url <u> POST error telemetry (startup / crash / API+client errors)
                   to this URL. Diagnostics only — never board content. Opt-in.

Both modes coordinate through files (.canvas, .better-canvas/) — run them
side by side, or either one alone.`)
  process.exit(0)
}

function reachableAddresses(): string[] {
  const addresses = ['127.0.0.1']
  for (const list of Object.values(networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) addresses.push(iface.address)
    }
  }
  return addresses
}

function flag(name: string): string | undefined {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    console.error(`${name} needs a value`)
    process.exit(1)
  }
  return value
}

function resolveWebDist(): string {
  const here = fileURLToPath(new URL('.', import.meta.url))
  const candidates = [
    path.join(here, 'web'), // published bundle: dist/better-canvas.mjs → dist/web
    path.join(here, '..', '..', 'web', 'dist'), // dev: packages/hub/src → packages/web/dist
  ]
  for (const dir of candidates) if (existsSync(path.join(dir, 'index.html'))) return dir
  return candidates[0]
}

const root = args.includes('--select-vault') ? '' : path.resolve(flag('--root') ?? process.cwd())
const command = args[0] && !args[0].startsWith('--') ? args[0] : 'mcp'
if (!['mcp', 'serve'].includes(command)) {
  console.error(`Unknown command: ${command}. Run better-canvas --help.`)
  process.exit(1)
}
if (command === 'serve' && !root) {
  console.error('serve needs --root <vault path>; --select-vault is for MCP mode.')
  process.exit(1)
}

if (command === 'serve') {
  const port = Number(flag('--port') ?? 5199)
  const host = flag('--host') ?? '127.0.0.1'
  const token = flag('--token')
  const agentCmd = flag('--agent-cmd')
  const handoffMode = flag('--handoff-mode') === 'spawn' ? ('spawn' as const) : ('signal' as const)
  const handoffTimeout = flag('--handoff-timeout')
  const handoffTimeoutMs = handoffTimeout ? Number(handoffTimeout) * 1000 : undefined
  const autoCommit = args.includes('--autocommit')
  const reporter = createReporter(flag('--report-url'), path.basename(root))
  // crashes are the whole point of telemetry — catch them before the process dies
  process.on('uncaughtException', (error) => {
    reporter.send('crash', { source: 'uncaughtException', ...errorDetail(error) })
    console.error('better-canvas hub: uncaught exception', error)
  })
  process.on('unhandledRejection', (reason) => {
    reporter.send('crash', { source: 'unhandledRejection', ...errorDetail(reason) })
  })
  const running = await startServe(root, { port, host, token, agentCmd, handoffMode, handoffTimeoutMs, autoCommit, reporter, webDist: resolveWebDist() })
  reporter.send('startup', { port: running.port })
  console.error(`better-canvas hub: serving ${root}`)
  const suffix = token ? `/?token=${encodeURIComponent(token)}` : '/'
  for (const address of host === '0.0.0.0' ? reachableAddresses() : [host]) {
    console.error(`  web    http://${address}:${running.port}${suffix}`)
  }
  if (host !== '127.0.0.1' && !token) {
    console.error('  ⚠  exposed beyond localhost WITHOUT --token: anyone on this network can read and edit boards under this root')
  }
} else {
  const server = createHubServer(root, resolveWebDist())
  await server.connect(new StdioServerTransport())
  // stdout carries the MCP protocol; log to stderr only
  console.error(`better-canvas hub: MCP over stdio, root ${root}`)
}

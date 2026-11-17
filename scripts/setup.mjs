#!/usr/bin/env node
// Build and print client configuration; do not mutate client permissions/config.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 18)) throw new Error('Node.js >=22.18 is required.')
if (!existsSync(path.join(root, 'node_modules'))) execFileSync('npm', ['ci'], { cwd: root, stdio: 'inherit' })
execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' })
console.log('Add this server to your MCP client, or build the desktop plugin with npm run plugin:pack:')
console.log(JSON.stringify({ mcpServers: { 'better-canvas': { command: process.execPath, args: [path.join(root, 'packages/hub/dist/better-canvas.mjs'), 'mcp', '--select-vault'] } } }, null, 2))

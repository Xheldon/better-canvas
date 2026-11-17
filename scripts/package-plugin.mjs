import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'dist', 'better-canvas')
if (!existsSync(path.join(root, 'packages/hub/dist/better-canvas.mjs'))) throw new Error('Run npm run build first.')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
// Explicit allowlist: never bundle a vault, local evaluation, or user configuration.
for (const name of ['plugin.json', 'mcp.json', 'skills', 'LICENSE', 'NOTICE', 'README.md', 'docs/compatibility.md', 'docs/privacy.md', 'docs/testing.md', 'docs/images/better-canvas.jpg', 'packages/hub/dist']) {
  cpSync(path.join(root, name), path.join(out, name), { recursive: true })
}
const version = JSON.parse(readFileSync(path.join(root, 'plugin.json'), 'utf8')).version
// The extracted ZIP can be registered as its own local marketplace.
const marketplace = JSON.parse(readFileSync(path.join(root, '.agents/plugins/marketplace.json'), 'utf8'))
marketplace.plugins[0].source.path = './'
mkdirSync(path.join(out, '.agents/plugins'), { recursive: true })
writeFileSync(path.join(out, '.agents/plugins/marketplace.json'), JSON.stringify(marketplace, null, 2) + '\n')
writeFileSync(path.join(out, 'package-info.json'), JSON.stringify({ version, runtime: 'Node.js >=22.18', includesDependencies: true }, null, 2))
const zip = path.join(root, 'dist', `better-canvas-${version}.zip`)
rmSync(zip, { force: true })
execFileSync('zip', ['-qr', zip, 'better-canvas'], { cwd: path.dirname(out) })
console.log(zip)

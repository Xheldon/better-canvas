#!/usr/bin/env node
// Build Better Canvas: bundle the hub (TypeScript, workspace dependencies
// included) into one standalone ESM file for Node 22.18 or later, and
// copy the prebuilt web client alongside it. The result under dist/ is the whole
// npm package (see package.json "files").
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const hubDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(hubDir, '..', '..')
const webDist = path.join(repoRoot, 'packages', 'web', 'dist')
const outDir = path.join(hubDir, 'dist')

// 1 — make sure the web client is built (it's a separate build step)
execFileSync('npm', ['run', 'build', '-w', '@better-canvas/web'], { cwd: repoRoot, stdio: 'inherit' })

// 2 — bundle the hub into a single self-contained ESM entry
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
await esbuild.build({
  entryPoints: [path.join(hubDir, 'src', 'cli.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: path.join(outDir, 'better-canvas.mjs'),
  // createRequire shim so bundled CJS deps' dynamic require() works under ESM.
  // (No shebang here — esbuild preserves the one already at the top of cli.ts.)
  banner: { js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" },
  logLevel: 'info',
})

// 3 — ship the web client next to the bundle (cli.ts resolves ./web at runtime)
cpSync(webDist, path.join(outDir, 'web'), { recursive: true })

// The MCP App uses the same React source, bundled into one offline UI resource.
const widget = await esbuild.build({
  entryPoints: [path.join(repoRoot, 'packages/web/src/main.tsx')],
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
  outfile: 'widget.js', write: false, minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
})
const js = widget.outputFiles.find(f => f.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script')
const css = widget.outputFiles.find(f => f.path.endsWith('.css')).text.replace(/<\/style/gi, '<\\/style')
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Better Canvas</title><style>' + css + '</style></head><body><div id="root"></div><script>window.__BETTER_CANVAS_MCP__=true;</script><script type="module">' + js + '</script></body></html>'
writeFileSync(path.join(outDir, 'web/widget.html'), html)
writeFileSync(path.join(webDist, 'widget.html'), html)

console.log('built Better Canvas → dist/better-canvas.mjs + dist/web/')

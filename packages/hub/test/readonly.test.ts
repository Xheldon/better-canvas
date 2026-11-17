import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { request } from 'node:http'
import { afterEach, expect, it } from 'vitest'
import { startServe, type RunningServer } from '../src/serve.ts'
let root = '', server: RunningServer | undefined
afterEach(async () => { await server?.close(); if (root) await rm(root,{recursive:true,force:true}) })
it('rejects every content mutation, including the removed editor routes, without changing bytes', async () => {
  root = await mkdtemp(path.join(tmpdir(),'canvas-readonly-'))
  const original = '{ "nodes": [], "edges": [], "extension": "keep" }'
  await writeFile(path.join(root,'Board.canvas'),original)
  await writeFile(path.join(root,'Note.md'),'Original note')
  server = await startServe(root,{port:0})
  const base = 'http://127.0.0.1:' + server.port
  const routes = ['/api/mutate','/api/boards','/api/board','/api/rename','/api/delete','/api/upload','/api/file','/api/handoff','/api/chat','/api/active','/api/layout']
  for (const route of routes) for (const method of ['POST','PUT','PATCH','DELETE']) {
    const response = await fetch(base+route,{method,headers:{'content-type':'application/json'},body:JSON.stringify({board:'Board.canvas',path:'Note.md',text:'Bad',changes:[{kind:'delete_node',id:'a'}]})})
    expect(response.status, method+' '+route).toBe(405)
  }
  expect(await readFile(path.join(root,'Board.canvas'),'utf8')).toBe(original)
  expect(await readFile(path.join(root,'Note.md'),'utf8')).toBe('Original note')
  const spoofedHostStatus = await new Promise<number | undefined>((resolve,reject) => {
    const req=request(base+'/api/boards',{headers:{host:'evil.example'}},res=>{res.resume();resolve(res.statusCode)})
    req.on('error',reject);req.end()
  })
  expect(spoofedHostStatus).toBe(403)
  expect((await fetch(base+'/api/boards',{headers:{'sec-fetch-site':'cross-site'}})).status).toBe(403)
})


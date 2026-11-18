import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { App } from '@modelcontextprotocol/ext-apps'
import { AppBridge, isToolVisibilityModelOnly } from '@modelcontextprotocol/ext-apps/app-bridge'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createHubServer } from '../src/server.ts'

it('completes the real MCP Apps SDK handshake, resolves a reference, and waits for the host message acknowledgment', async () => {
  // This is a protocol host, not an actual ChatGPT/Codex desktop acceptance test.
  const root = await mkdtemp(path.join(tmpdir(),'canvas-mcp-app-'))
  await writeFile(path.join(root,'Board.canvas'),JSON.stringify({nodes:[{id:'a',type:'text',text:'Card',x:0,y:0,width:200,height:100}],edges:[]}))
  const server = createHubServer(root)
  const client = new Client({name:'test-host',version:'1'})
  const serverTransports=InMemoryTransport.createLinkedPair()
  const appTransports=InMemoryTransport.createLinkedPair()
  const app=new App({name:'test-ui',version:'1'},{},{autoResize:false})
  let reject=false
  const received: unknown[]=[]
  const bridge=new AppBridge(null,{name:'test-host',version:'1'},{serverTools:{},message:{text:{}}})
  bridge.onmessage=async value=>{received.push(value);return {isError:reject}}
  // Visibility enforcement is a host responsibility, not an HTTP permission.
  bridge.oncalltool=async params=>{
    const tool=(await client.listTools()).tools.find(t=>t.name===params.name)
    if (!tool || isToolVisibilityModelOnly(tool)) return {isError:true,content:[{type:'text',text:'Tool is unavailable to the app.'}]}
    return client.callTool(params)
  }
  try {
    await Promise.all([client.connect(serverTransports[0]),server.connect(serverTransports[1])])
    await bridge.connect(appTransports[0])
    await app.connect(appTransports[1])
    expect(app.getHostCapabilities()?.message?.text).toBeDefined()
    const snapshot=await app.callServerTool({name:'get_preview',arguments:{board:'Board.canvas'}})
    const reference=await app.callServerTool({name:'create_reference',arguments:{workspaceId:(snapshot.structuredContent as Record<string,unknown>).workspaceId,sessionId:'app',board:'Board.canvas',nodeIds:['a'],edgeIds:[],revision:(snapshot.structuredContent as Record<string,unknown>).revision}})
    expect(reference.isError).not.toBe(true)
    const id=(reference.structuredContent as Record<string,unknown>).id
    const ack=await app.sendMessage({role:'user',content:[{type:'text',text:'Update the heading. Reference: '+id}]})
    expect(ack.isError).toBe(false)
    expect(received).toEqual([{role:'user',content:[{type:'text',text:'Update the heading. Reference: '+id}]}])
    const resolved=await client.callTool({name:'read_reference',arguments:{id}})
    expect((resolved.structuredContent as Record<string,unknown>).nodeIds).toEqual(['a'])
    reject=true
    expect((await app.sendMessage({role:'user',content:[{type:'text',text:'A rejected request'}]})).isError).toBe(true)
    // The host bridge must not expose AI-only mutation tools to the app.
    const denied=await app.callServerTool({name:'apply_ops',arguments:{}})
    expect(denied).toMatchObject({isError:true,content:[{type:'text',text:'Tool is unavailable to the app.'}]})
  } finally {
    await app.close();await bridge.close();await client.close();await server.close()
    await rm(root,{recursive:true,force:true})
  }
})

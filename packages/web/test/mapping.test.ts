import { describe, expect, it } from 'vitest'
import { absolutePosition, toFlow } from '../src/board/mapping'
import type { CanvasData } from '../src/api'

describe('JSON Canvas layout fidelity', () => {
  it('preserves absolute geometry, array layer order, nested containment, and edge ends without changing source data', () => {
    const data: CanvasData = { extension: true, nodes:[
      {id:'outer',type:'group',x:-600,y:-200,width:1200,height:900,label:'Outer'},
      {id:'inner',type:'group',x:-400,y:-100,width:700,height:600,label:'Inner'},
      {id:'a',type:'text',x:-300,y:0,width:231,height:147,text:'A'},
      {id:'b',type:'file',x:350,y:250,width:200,height:160,file:'note.md',subpath:'#Target'},
    ], edges:[{id:'edge',fromNode:'a',toNode:'b',fromSide:'top',toSide:'bottom',fromEnd:'arrow',toEnd:'none'}] }
    const original=structuredClone(data)
    const flow=toFlow(data,new Set())
    const byId=new Map(flow.nodes.map(n=>[n.id,n]))
    data.nodes!.forEach((n,i)=>{
      const rendered=byId.get(n.id)!
      expect(absolutePosition(rendered,byId)).toEqual({x:n.x,y:n.y})
      expect(rendered.style).toMatchObject({width:n.width,height:n.height,'--bc-z':i})
    })
    expect(byId.get('inner')!.parentId).toBe('outer')
    expect(byId.get('a')!.parentId).toBe('inner')
    expect(flow.edges[0]).toMatchObject({sourceHandle:'top',targetHandle:'bottom'})
    expect(flow.edges[0].markerStart).toBeDefined()
    expect(flow.edges[0].markerEnd).toBeUndefined()
    expect(data).toEqual(original)
  })
  it('does not make equal-size groups cyclic parents',()=>{
    const flow=toFlow({nodes:['a','b'].map(id=>({id,type:'group',x:0,y:0,width:200,height:200}))},new Set())
    expect(flow.nodes.every(n=>!n.parentId)).toBe(true)
  })
})

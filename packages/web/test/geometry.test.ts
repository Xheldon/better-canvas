import { expect, it } from 'vitest'
import { edgeGeometry, fit, initialView, world, zoomAt } from '../src/geometry'
import type { CanvasNode } from '@better-canvas/core'
const a: CanvasNode = {id:'a',type:'text',x:-100,y:50,width:200,height:120}
const b: CanvasNode = {id:'b',type:'text',x:500,y:500,width:200,height:120}
it('keeps the world point under the pointer fixed while zooming', () => {
  const view={x:100,y:-60,scale:.5}, pointer={x:350,y:220}
  expect(world(pointer,zoomAt(view,pointer,1.6))).toEqual(world(pointer,view))
})
it('fits negative coordinates without rewriting them', () => {
  const before=structuredClone([a,b]), v=fit([a,b],{width:900,height:600})
  for(const n of [a,b]){
    expect(n.x*v.scale+v.x).toBeGreaterThanOrEqual(0)
    expect((n.x+n.width)*v.scale+v.x).toBeLessThanOrEqual(900)
    expect(n.y*v.scale+v.y).toBeGreaterThanOrEqual(0)
    expect((n.y+n.height)*v.scale+v.y).toBeLessThanOrEqual(600)
  }
  expect([a,b]).toEqual(before)
})
it('anchors an edge to the exact requested sides', () => {
  const g=edgeGeometry({id:'e',fromNode:'a',toNode:'b',fromSide:'bottom',toSide:'left'},a,b)
  expect(g.path.startsWith('M 0 170 C')).toBe(true)
  expect(g.path.endsWith(', 500 560')).toBe(true)
})
it('opens a long vertical flow at its top central cards instead of an outlying legend', () => {
  const flow=Array.from({length:20},(_,i)=>({...a,id:String(i),x:400,y:i*300}))
  const legend={...a,id:'legend',x:-500,y:0}
  const view=initialView([legend,...flow],{width:700,height:800})
  expect(500*view.scale+view.x).toBe(350)
  expect(view.y).toBe(64)
  expect(view.scale).toBeGreaterThan(.6)
})


// @vitest-environment jsdom
import React, { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CanvasViewer } from '../src/CanvasViewer'
import { Composer } from '../src/Composer'
import type { Client } from '../src/client'
import type { CanvasData } from '@better-canvas/core'

beforeEach(() => {
  // Layout and pointer capture are browser APIs absent from jsdom's layout engine.
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function setup(initial: string[] = []) {
  const data: CanvasData = { nodes: [
    {id:'group',type:'group',label:'Group',x:0,y:0,width:470,height:100},
    {id:'a',type:'text',text:'# Alpha',x:10,y:10,width:100,height:60},
    {id:'b',type:'text',text:'# Beta',x:170,y:10,width:100,height:60},
    {id:'c',type:'text',text:'# Gamma',x:330,y:10,width:100,height:60},
  ], edges:[{id:'ab',fromNode:'a',toNode:'b'}] }
  const original = JSON.stringify(data)
  const client = {mode:'browser',canSend:false} as Client
  function Harness() {
    const [selected, select] = useState(initial)
    return <>
      <CanvasViewer data={data} client={client} selected={selected} onSelect={select} refreshKey={0} />
      <Composer client={client} cards={data.nodes!.filter(n => selected.includes(n.id))}
        selection={{sessionId:'test',board:'Test.canvas',revision:'unchanged',nodeIds:selected,edgeIds:[]}}
        onRemove={id => select(ids => ids.filter(i => i !== id))} onClear={() => select([])} />
    </>
  }
  render(<Harness />)
  const viewer = screen.getByLabelText('Canvas read-only view')
  const captured = new Set<number>()
  viewer.setPointerCapture = id => { captured.add(id) }
  viewer.hasPointerCapture = id => captured.has(id)
  viewer.releasePointerCapture = id => { captured.delete(id) }
  vi.spyOn(viewer,'getBoundingClientRect').mockReturnValue({left:80,top:50,width:900,height:600,right:980,bottom:650,x:80,y:50,toJSON(){}})
  const card = (name: string) => screen.getByRole('option',{name})
  const selected = () => [...viewer.querySelectorAll('[aria-selected="true"]')].map(n => n.getAttribute('data-node-id'))
  const view = () => {
    const transform = (viewer.querySelector('.world') as HTMLElement).style.transform
    // CSSOM may serialize translate(x, 0) as translate(x).
    const translation = /translate\(([^)]+)\)/.exec(transform)![1]!.split(',').map(parseFloat)
    const scale = Number(/scale\(([^)]+)\)/.exec(transform)![1])
    return {x:translation[0]!,y:translation[1] ?? 0,scale}
  }
  return {viewer,card,selected,view,data,original,captured}
}
const pointer = (x: number, y: number, shiftKey = true) => ({pointerId:1,button:0,buttons:1,clientX:x,clientY:y,shiftKey})

it('Shift-drags from card text, updates composer references while dragging, and preserves source geometry', () => {
  const {viewer,selected,data,original,captured} = setup(['c'])
  fireEvent.pointerDown(screen.getByRole('heading',{name:'Alpha'}),pointer(95,65))
  fireEvent.pointerMove(viewer,pointer(97,66))
  expect(selected()).toEqual(['c']) // Small click jitter is not a selection rectangle.
  fireEvent.pointerMove(viewer,pointer(370,125))
  expect(selected()).toEqual(['a','b','c'])
  const chips = screen.getByLabelText('Selected card references')
  expect(chips.textContent).toContain('Alpha')
  expect(chips.textContent).toContain('Beta')
  expect(chips.textContent).toContain('Gamma')
  expect(chips.textContent).not.toContain('Group')
  expect(viewer.querySelector('.selection-box')).not.toBeNull()
  fireEvent.pointerUp(viewer,pointer(370,125))
  expect(viewer.querySelector('.selection-box')).toBeNull()
  expect(captured.size).toBe(0)
  expect(JSON.stringify(data)).toBe(original)
})

it('Shift-click toggles a reference and a reverse background drag selects intersecting cards', () => {
  const {viewer,card,selected} = setup()
  for (const expected of [['a'],[]]) {
    fireEvent.pointerDown(card('Alpha'),pointer(95,65))
    fireEvent.pointerUp(viewer,pointer(95,65))
    expect(selected()).toEqual(expected)
  }
  fireEvent.pointerDown(viewer,pointer(370,125))
  fireEvent.pointerMove(viewer,pointer(85,55))
  fireEvent.pointerUp(viewer,pointer(85,55))
  expect(selected()).toEqual(['a','b'])
})

it('cancels interrupted selection and lets Escape clear it without a later pointer-up restoring it', () => {
  const {viewer,selected} = setup(['c'])
  fireEvent.pointerDown(viewer,pointer(85,55))
  fireEvent.pointerMove(viewer,pointer(370,125))
  expect(selected()).toEqual(['a','b','c'])
  fireEvent.pointerCancel(viewer,pointer(370,125))
  expect(selected()).toEqual(['c'])
  expect(viewer.querySelector('.selection-box')).toBeNull()
  fireEvent.pointerDown(viewer,pointer(85,55))
  fireEvent.pointerMove(viewer,pointer(370,125))
  fireEvent.keyDown(viewer,{key:'Escape'})
  fireEvent.pointerUp(viewer,pointer(370,125))
  expect(selected()).toEqual([])
})

it.each(['metaKey','ctrlKey'])('%s + wheel zooms both ways around the cursor without changing cards or references', modifier => {
  const {viewer,view,selected,data,original} = setup(['a'])
  const event = new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:280,clientY:150,deltaY:-60,[modifier]:true})
  fireEvent(viewer,event)
  expect(event.defaultPrevented).toBe(true)
  const enlarged = view()
  expect(enlarged.scale).toBeGreaterThan(1)
  expect((200 - enlarged.x) / enlarged.scale).toBeCloseTo(200)
  expect((100 - enlarged.y) / enlarged.scale).toBeCloseTo(100)
  fireEvent.wheel(viewer,{clientX:280,clientY:150,deltaY:60,[modifier]:true})
  expect(view().scale).toBeCloseTo(1)
  expect(selected()).toEqual(['a'])
  expect(JSON.stringify(data)).toBe(original)
})

it('normalizes line wheel deltas and selects correctly after zooming and panning', () => {
  const {viewer,view,selected} = setup()
  fireEvent.wheel(viewer,{clientX:80,clientY:50,deltaY:-3,deltaMode:1,metaKey:true})
  const zoomed = view()
  expect(zoomed.scale).toBeCloseTo(Math.exp(48 * .006))
  fireEvent.wheel(viewer,{deltaX:20,deltaY:30})
  expect(view()).toEqual({...zoomed,x:zoomed.x - 20,y:zoomed.y - 30})
  const current = view(), project = (x: number,y: number) => pointer(80 + current.x + x * current.scale,50 + current.y + y * current.scale)
  fireEvent.pointerDown(viewer,project(5,5))
  fireEvent.pointerMove(viewer,project(290,80))
  fireEvent.pointerUp(viewer,project(290,80))
  expect(selected()).toEqual(['a','b'])
})

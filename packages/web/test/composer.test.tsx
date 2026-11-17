// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Composer, shouldSubmit } from '../src/Composer'
import type { Client } from '../src/client'
afterEach(cleanup)
const selection={sessionId:'s',board:'Board.canvas',nodeIds:['a'],edgeIds:[],revision:'revision'}
const cards=[{id:'a',type:'text',text:'Original card',x:0,y:0,width:300,height:200}]
function setup(canSend=true) {
  const reference=vi.fn(async(value)=>({...value,id:'ref',citation:'reference'}))
  const send=vi.fn(async()=>{})
  const client={mode:'mcp',canSend,reference,send} as unknown as Client
  render(<Composer client={client} cards={cards} selection={selection} onRemove={()=>{}} onClear={()=>{}} />)
  return {reference,send,input:screen.getByRole('textbox'),button:screen.getByRole('button',{name:'Send to current chat'})}
}
it('sends selected references and the instruction once, after Enter, without a modal',async()=>{
  const {input,reference,send}=setup()
  fireEvent.change(input,{target:{value:'Make the heading clearer'}})
  fireEvent.keyDown(input,{key:'Enter'})
  fireEvent.keyDown(input,{key:'Enter'})
  await waitFor(()=>expect(send).toHaveBeenCalledTimes(1))
  expect(reference).toHaveBeenCalledWith(selection)
  expect(send.mock.calls[0]).toEqual([expect.objectContaining({id:'ref',nodeIds:['a']}),'Make the heading clearer'])
  await waitFor(()=>expect((input as HTMLTextAreaElement).value).toBe(''))
  expect(screen.queryByRole('dialog')).toBeNull()
})
it('keeps the draft when the host rejects a message',async()=>{
  const {input,send}=setup()
  send.mockRejectedValueOnce(new Error('Host rejected'))
  fireEvent.change(input,{target:{value:'Keep this draft'}})
  fireEvent.keyDown(input,{key:'Enter'})
  await screen.findByText('Host rejected')
  expect((input as HTMLTextAreaElement).value).toBe('Keep this draft')
})
it('does not submit IME confirmation or Shift+Enter',()=>{
  for(const event of [
    {key:'Enter',shiftKey:true,composing:false},
    {key:'Enter',shiftKey:false,composing:true},
    {key:'Enter',shiftKey:false,composing:false,keyCode:229},
  ]) expect(shouldSubmit(event)).toBe(false)
  const {input,send}=setup()
  fireEvent.change(input,{target:{value:'中文输入'}})
  fireEvent.compositionStart(input)
  fireEvent.keyDown(input,{key:'Enter'})
  expect(send).not.toHaveBeenCalled()
})
it('does not pretend a regular browser is connected',()=>{
  const {input,button,send,reference}=setup(false)
  fireEvent.change(input,{target:{value:'Try to send'}})
  fireEvent.keyDown(input,{key:'Enter'})
  expect((button as HTMLButtonElement).disabled).toBe(true)
  expect(send).not.toHaveBeenCalled()
  expect(reference).not.toHaveBeenCalled()
  expect(screen.getByRole('status').textContent).toContain('not connected')
})

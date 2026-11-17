import { describe, expect, it } from 'vitest'
import { applyOps, type CanvasData } from '../src/index.ts'
const board: CanvasData = { plugin: { keep: true }, nodes: [
  { id: 'a', type: 'text', text: 'Before', x: -120, y: 400, width: 350, height: 180, extra: ['keep'] },
  { id: 'b', type: 'file', file: 'Notes.md', x: 300, y: 400, width: 350, height: 180 },
], edges: [{ id: 'e', fromNode: 'a', toNode: 'b', toEnd: 'none', extra: 1 }] }
describe('AI operations', () => {
  it('changes only requested fields and leaves original object untouched', () => {
    const after = applyOps(board, [{ op: 'update_node', id: 'a', patch: { text: 'After' } }])
    expect(after).toEqual({ ...board, nodes: [{ ...board.nodes![0], text: 'After' }, board.nodes![1]] })
    expect(board.nodes![0]!.text).toBe('Before')
  })
  it('rejects an invalid transaction without partially applying earlier changes', () => {
    expect(() => applyOps(board, [{ op:'update_node',id:'a',patch:{text:'Never saved'} },{op:'update_node',id:'missing',patch:{text:'x'}}])).toThrow('Unknown')
    expect(board.nodes![0]!.text).toBe('Before')
    expect(() => applyOps(board,[{op:'update_node',id:'a',patch:{width:-20}}])).toThrow('geometry')
  })
  it('removes attached edges with a deleted node and preserves remaining records', () => {
    expect(applyOps(board,[{op:'delete_node',id:'a'}])).toEqual({...board,nodes:[board.nodes![1]],edges:[]})
  })
  it('rejects duplicate IDs, changed IDs, prototype properties and orphan edges', () => {
    expect(() => applyOps(board,[{op:'add_node',node:board.nodes![0]!}])).toThrow('already exists')
    expect(() => applyOps(board,[{op:'update_node',id:'a',patch:{id:'other'}}])).toThrow('cannot be patched')
    expect(() => applyOps(board,[{op:'update_node',id:'a',patch:JSON.parse('{"__proto__":{"polluted":true}}')}])).toThrow('cannot be patched')
    expect(() => applyOps(board,[{op:'add_edge',edge:{id:'new',fromNode:'a',toNode:'missing'}}])).toThrow('endpoint')
  })
})

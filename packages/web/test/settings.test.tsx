// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { FolderTree } from '../src/FolderTree'
import { AppWithClient } from '../src/App'
import type { Client, Snapshot } from '../src/client'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  // Native dialog layout/focus is checked separately in the browser smoke test.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('keeps folders and Canvas files nested, expands the active path, and filters without flattening', () => {
  const boards = ['Root.canvas', 'Planning/Week 2/Review.canvas', 'Planning/Week 1/Review.canvas', 'Archive/Old.canvas'].map(path => ({ path, nodes: 1, edges: 0 }))
  const choose = vi.fn()
  const view = render(<FolderTree boards={boards} active="Planning/Week 1/Review.canvas" query="" onChoose={choose} />)
  const planning = screen.getByRole('button', { name: 'Planning' })
  expect(planning.getAttribute('aria-expanded')).toBe('true')
  const week = screen.getByRole('button', { name: 'Week 1' })
  expect(week.closest('li')?.parentElement?.closest('li')).toBe(planning.closest('li'))
  const leaf = within(week.closest('li')!).getByRole('button', { name: 'Review.canvas' })
  fireEvent.click(leaf)
  expect(choose).toHaveBeenCalledWith('Planning/Week 1/Review.canvas')
  fireEvent.click(planning)
  expect(screen.queryByRole('button', { name: 'Week 1' })).toBeNull()
  view.rerender(<FolderTree boards={boards} active="Planning/Week 1/Review.canvas" query="week 2" onChoose={choose} />)
  expect(screen.queryByText('Archive')).toBeNull()
  expect(screen.queryByText('Root')).toBeNull()
  expect(screen.queryByText('Week 1')).toBeNull()
  expect(screen.getByText('Planning')).toBeTruthy()
  const searchFolder = screen.getByRole('button', { name: 'Week 2' })
  expect(within(searchFolder.closest('li')!).getByText('Review')).toBeTruthy()
  fireEvent.click(searchFolder)
  expect(screen.queryByText('Review')).toBeNull()
})

function snapshot(workspaceId: string): Snapshot {
  return { workspaceId, directory: '/' + workspaceId, directoryName: workspaceId, board: 'Planning/Board.canvas', revision: 'identical',
    boards: [{ path: 'Planning/Board.canvas', nodes: 1, edges: 0 }],
    data: { nodes: [{ id: 'a', type: 'text', text: '# Same card', x: 0, y: 0, width: 200, height: 100 }], edges: [] } }
}
function setup(initial: Snapshot) {
  let current = initial, refresh = () => {}
  const preview = vi.fn(async () => current)
  const setDirectory = vi.fn(async () => { current = snapshot('second'); return current })
  const selection = vi.fn(async () => {})
  const client: Client = { mode: 'mcp', canSend: true, preview, setDirectory, selection,
    file: vi.fn(), reference: vi.fn(), send: vi.fn(), subscribe: listener => { refresh = listener; return () => {} } }
  render(<AppWithClient client={client} />)
  return { preview, setDirectory, selection, refresh: () => refresh(), external: (value: Snapshot) => { current = value; refresh() } }
}

it('opens the directory chooser from an unconfigured panel and reports invalid paths in place', async () => {
  const { setDirectory } = setup({ workspaceId: 'empty', needsVault: true, boards: [] })
  fireEvent.click(await screen.findByRole('button', { name: 'Choose working directory' }))
  const dialog = screen.getByRole('dialog'), input = within(dialog).getByRole('textbox', { name: 'Working directory' })
  fireEvent.change(input, { target: { value: '/missing' } })
  setDirectory.mockRejectedValueOnce(new Error('Directory not found'))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Open directory' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Directory not found')
  expect((input as HTMLInputElement).value).toBe('/missing')
  fireEvent.change(input, { target: { value: '/second' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Open directory' }))
  await screen.findByRole('heading', { name: 'Same card' })
  expect(setDirectory).toHaveBeenLastCalledWith('/second', 'empty')
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('clears selection and draft when another panel switches to a same-name canvas, even with the same revision', async () => {
  const { selection, external, preview } = setup(snapshot('first'))
  await screen.findByRole('option', { name: 'Same card' })
  // The viewer supports keyboard selection; this also avoids depending on jsdom layout.
  fireEvent.keyDown(screen.getByLabelText('Canvas read-only view'), { key: 'a', ctrlKey: true })
  const input = screen.getByRole('textbox', { name: 'Change request' })
  fireEvent.change(input, { target: { value: 'Draft for the first directory' } })
  await waitFor(() => expect(selection).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: 'first', nodeIds: ['a'] })))
  external(snapshot('second'))
  await waitFor(() => expect(selection).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: 'second', nodeIds: [] })))
  expect((screen.getByRole('textbox', { name: 'Change request' }) as HTMLTextAreaElement).value).toBe('')
  expect(screen.queryByLabelText('Selected card references')).toBeNull()
  expect(preview).toHaveBeenLastCalledWith('Planning/Board.canvas', 'first')
})

it('discards an older in-flight preview when the user switches directories in Settings', async () => {
  const { preview, setDirectory, selection, refresh } = setup(snapshot('first'))
  await screen.findByRole('heading', { name: 'Same card' })
  let oldResponse!: (value: Snapshot) => void
  preview.mockImplementationOnce(() => new Promise<Snapshot>(resolve => { oldResponse = resolve }))
  refresh()
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Working directory' }), { target: { value: '/second' } })
  fireEvent.click(screen.getByRole('button', { name: 'Open directory' }))
  await waitFor(() => expect(setDirectory).toHaveBeenCalledWith('/second', 'first'))
  await waitFor(() => expect(selection).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: 'second' })))
  oldResponse(snapshot('first'))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(selection).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: 'second' }))
})

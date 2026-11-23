// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WriteIssueError, type PanelChange } from '@better-canvas/core'
import { AppWithClient } from '../src/App'
import type { Client, Snapshot } from '../src/client'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })
it('reads a shared image once while idle, refreshes only the changed attachment, and keeps the draft on a missing target', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  let notify!: (change?: PanelChange) => void
  const image = (id: string, file: string) => ({ id, file, type: 'file', x: 0, y: 0, width: 100, height: 80 })
  const value: Snapshot = { workspaceId: 'scope', board: 'Example.canvas', boards: [], revision: 'initial', cursor: 'opening',
    data: { nodes: [image('a', 'Images/A.png'), image('b', 'Images/B.png'), image('c', 'Images/A.png')] } }
  const preview = vi.fn(async () => value)
  const file = vi.fn(async (path: string) => ({ kind: 'image' as const, path, watchPath: path.replace('Images/', ''), src: 'data:image/png;base64,AA==' }))
  const selection = vi.fn(async () => ({})), send = vi.fn(), reference = vi.fn()
  const client: Client = { mode: 'mcp', canSend: true, preview, file, selection, send, reference, setDirectory: vi.fn(),
    subscribe: listener => { notify = listener; return () => {} } }
  await act(async () => { render(<AppWithClient client={client} />) })
  expect(file).toHaveBeenCalledTimes(2)
  fireEvent.keyDown(screen.getByLabelText('Canvas read-only view'), { key: 'a', ctrlKey: true })
  const saves = selection.mock.calls.length
  await act(async () => { await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000) })
  expect(preview).toHaveBeenCalledTimes(1)
  expect(file).toHaveBeenCalledTimes(2)
  expect(selection).toHaveBeenCalledTimes(saves)
  await act(async () => notify({ type: 'board_changed', path: 'Example.canvas' }))
  expect(preview).toHaveBeenCalledTimes(2)
  expect(file).toHaveBeenCalledTimes(2)
  await act(async () => notify({ type: 'file_changed', path: 'A.png' }))
  expect(file).toHaveBeenCalledTimes(3)
  expect(file.mock.calls.at(-1)?.[0]).toBe('Images/A.png')
  preview.mockResolvedValue({ ...value, revision: 'external-removal', data: { nodes: value.data!.nodes!.filter(n => n.id !== 'b') } })
  await act(async () => notify({ type: 'board_changed', path: 'Example.canvas' }))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(screen.getByLabelText('Selected card references').textContent).toContain('B.png')
  reference.mockRejectedValueOnce(new WriteIssueError({ code: 'missing_targets', path: 'Example.canvas', nodeIds: ['b'], edgeIds: [] }))
  const input = screen.getByRole('textbox', { name: 'Change request' })
  fireEvent.change(input, { target: { value: 'Keep my request' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send to current chat' })))
  expect(screen.getByRole('alertdialog').textContent).toContain('b')
  expect(reference).toHaveBeenCalledWith(expect.objectContaining({ nodeIds: ['a', 'b', 'c'] }))
  expect(send).not.toHaveBeenCalled()
  expect((input as HTMLTextAreaElement).value).toBe('Keep my request')
})

import { useRef, useState, type KeyboardEvent } from 'react'
import type { CanvasNode } from '@better-canvas/core'
import type { Client, Selection } from './client'
import { title } from './geometry'
import { s } from './strings'
import { WriteIssueError, type WriteIssue } from '@better-canvas/core'

export function shouldSubmit(event: { key: string; shiftKey: boolean; composing: boolean; keyCode?: number }) {
  return event.key === 'Enter' && !event.shiftKey && !event.composing && event.keyCode !== 229
}
export function Composer({ client, cards, selection, onRemove, onClear, onIssue, ready = true }: {
  client: Client; cards: CanvasNode[]; selection?: Selection; onRemove(id: string): void; onClear(): void; onIssue?(issue: WriteIssue): void; ready?: boolean
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const composing = useRef(false), sending = useRef(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const disabled = !client.canSend || !selection || !cards.length || !draft.trim() || busy || !ready
  async function submit() {
    if (disabled || sending.current || !selection) return
    sending.current = true; setBusy(true); setError(''); setStatus('')
    const text = draft.trim(), captured = { ...selection, nodeIds: [...selection.nodeIds], edgeIds: [...selection.edgeIds] }
    try {
      const reference = await client.reference(captured)
      await client.send(reference, text)
      setDraft(current => current.trim() === text ? '' : current)
      setStatus(s.sent)
    } catch (e) { if (e instanceof WriteIssueError && onIssue) onIssue(e.issue); else setError((e as Error).message) }
    finally { sending.current = false; setBusy(false) }
  }
  function key(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (shouldSubmit({ key: event.key, shiftKey: event.shiftKey, composing: composing.current || event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode })) {
      event.preventDefault(); void submit()
    }
  }
  return <section className="composer" aria-label={s.draft}>
    <div className="composer-head">
      <span className={'connection-dot ' + (client.canSend ? 'connected' : '')} />
      <span>{cards.length ? s.select : s.empty}</span>
      {!!cards.length && <button type="button" className="quiet-button clear-selection" onClick={onClear}>{s.clear}</button>}
    </div>
    {!!cards.length && <div className="reference-list" aria-label="Selected card references">
      {cards.map(card => <span className="reference-chip" key={card.id} title={title(card) + ' · ' + card.id}>
        <span className="chip-symbol">▧</span><span className="chip-title">{title(card)}</span>
        <button type="button" aria-label={s.remove + ': ' + title(card)} onClick={() => onRemove(card.id)}>×</button>
      </span>)}
    </div>}
    <div className="composer-input-row">
      <textarea ref={input} aria-label={s.draft} rows={2} value={draft} maxLength={8000}
        placeholder={cards.length ? s.placeholder : s.empty}
        onChange={e => { setDraft(e.target.value); setStatus(''); setError('') }}
        onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} onKeyDown={key} />
      <button type="button" className="send-button" disabled={disabled} onClick={() => void submit()} title={client.canSend ? s.send : s.disconnected} aria-label={s.send}>{busy ? '···' : '↑'}</button>
    </div>
    <div className={'composer-foot ' + (error ? 'error' : '')} role="status" aria-live="polite">
      <span>{error || status || (client.canSend ? s.connected : s.disconnected)}</span>
      {client.canSend && <span className="enter-hint">{s.enter}</span>}
    </div>
  </section>
}

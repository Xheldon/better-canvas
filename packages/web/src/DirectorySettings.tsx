import { useEffect, useRef, useState } from 'react'
import { s } from './strings'

export function DirectorySettings({ directory, onSave, onClose }: {
  directory: string; onSave(path: string): Promise<void>; onClose(): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [value, setValue] = useState(directory)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const savingRef = useRef(false)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title" onCancel={event => {
    event.preventDefault(); if (!savingRef.current) onClose()
  }}>
    <form onSubmit={async event => {
      event.preventDefault()
      if (savingRef.current || !value.trim()) return
      savingRef.current = true; setSaving(true); setError('')
      try { await onSave(value.trim()); onClose() }
      catch (e) { setError((e as Error).message) }
      finally { savingRef.current = false; setSaving(false) }
    }}>
      <div className="settings-heading"><h2 id="settings-title">{s.settings}</h2><button type="button" className="quiet-button" aria-label={s.close} onClick={onClose} disabled={saving}>×</button></div>
      <label htmlFor="directory-path">{s.directory}</label>
      <p id="directory-help">{s.directoryHelp}</p>
      <input id="directory-path" type="text" value={value} onChange={e => setValue(e.target.value)} autoFocus autoComplete="off" spellCheck={false} placeholder={s.directoryPlaceholder} aria-describedby="directory-help directory-reference" disabled={saving} />
      <p id="directory-reference" className="settings-note">{s.directoryReference}</p>
      <p className="settings-note">{s.rememberDirectory}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="settings-actions"><button type="button" className="quiet-button" onClick={onClose} disabled={saving}>{s.cancel}</button><button type="submit" className="primary-button" disabled={saving || !value.trim()}>{saving ? s.opening : s.openDirectory}</button></div>
    </form>
  </dialog>
}

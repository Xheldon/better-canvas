import { useEffect, useRef } from 'react'
import type { WriteIssue } from '@better-canvas/core'
import { s } from './strings'

export function WriteWarning({ issue, close }: { issue: WriteIssue; close(): void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} role="alertdialog" className="settings-dialog" aria-labelledby="write-warning-title" aria-describedby="write-warning-detail"
    onCancel={e => { e.preventDefault(); close() }}>
    <h2 id="write-warning-title">{issue.code === 'missing_file' ? s.fileGone : s.itemsGone}</h2>
    <p id="write-warning-detail">{issue.path}{[...issue.nodeIds, ...issue.edgeIds].map(id => <span key={id}> · <code>{id}</code></span>)}</p>
    <p>{issue.code === 'missing_file' ? s.missingFileHint : s.missingItemsHint}</p>
    <div className="settings-actions"><button autoFocus type="button" className="primary-button" onClick={close}>{s.dismiss}</button></div>
  </dialog>
}

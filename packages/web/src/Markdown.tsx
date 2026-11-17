import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => {
    const rendered = marked.parse(text, { async: false, breaks: true, gfm: true })
    return DOMPurify.sanitize(rendered, { FORBID_TAGS: ['img', 'iframe', 'style', 'input', 'button', 'form', 'video', 'audio', 'svg'], FORBID_ATTR: ['style', 'id'] })
  }, [text])
  // Cards are selectable surfaces. Link cards and Markdown URLs never load remote embeds.
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} onClick={e => { if ((e.target as HTMLElement).closest('a')) e.preventDefault() }} />
}

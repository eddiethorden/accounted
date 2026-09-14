import type { ReadPage } from './types'

/** Plain text and HTML bodies (mail underlag). HTML is reduced to its text. */
export function readTextDocument(bytes: Buffer, mimeType: string): ReadPage[] {
  const raw = bytes.toString('utf8')
  const isHtml = mimeType === 'text/html' || mimeType === 'application/xhtml+xml'
  const text = (isHtml ? htmlToText(raw) : raw).trim()
  if (!text) return []
  return [{ pageNo: 1, text, reader: isHtml ? 'html' : 'text', hasTextLayer: true }]
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|br|li|tr|h[1-6]|table|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

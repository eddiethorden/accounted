import type { AiImageMediaType } from '@/lib/ai'
import { extractSinglePagePdf, readPdfTextLayer } from './pdf'
import { readOfficeDocument } from './office'
import { readTextDocument } from './text'
import { readImageWithModel, transcribeWithModel } from './vision'
import { readerForMime, type ReadOutcome, type ReadPage } from './types'

/**
 * Decide how a document is read and read it. Text layers first (local, free,
 * with word boxes), the model only for scanned pages and photos.
 */
export async function readDocumentBytes(bytes: Buffer, mimeType: string | null | undefined): Promise<ReadOutcome> {
  const reader = readerForMime(mimeType)
  if (reader === null) return { ok: false, skipped: 'unsupported_mime' }
  if (reader === 'structured') return { ok: false, skipped: 'structured' }
  if (bytes.length === 0) return { ok: false, skipped: 'empty' }

  if (reader === 'pdf_text') {
    const local = await readPdfTextLayer(bytes)
    const pages: ReadPage[] = [...local.pages]
    for (const pageNo of local.pagesNeedingVision) {
      const single = await extractSinglePagePdf(bytes, pageNo)
      const out = await transcribeWithModel({ kind: 'pdf', data: single, fileName: `page-${pageNo}.pdf` })
      if (!out.ok) {
        // Text pages are still worth keeping; the scanned ones wait for a configured model.
        if (pages.length === 0) return { ok: false, skipped: 'ai_unconfigured' }
        break
      }
      if (out.text) pages.push({ pageNo, text: out.text, reader: 'claude_vision', hasTextLayer: false })
    }
    pages.sort((a, b) => a.pageNo - b.pageNo)
    if (pages.length === 0) return { ok: false, skipped: 'empty' }
    const readerUsed = local.pages.length > 0 ? 'pdf_text' : 'claude_vision'
    return { ok: true, pages, reader: readerUsed, pageCount: local.pageCount }
  }

  if (reader === 'claude_vision') {
    const out = await readImageWithModel(bytes, mimeType as AiImageMediaType)
    if (!out.ok) return { ok: false, skipped: 'ai_unconfigured' }
    if (out.pages.length === 0) return { ok: false, skipped: 'empty' }
    return { ok: true, pages: out.pages, reader: 'claude_vision', pageCount: 1 }
  }

  if (reader === 'office') {
    const pages = await readOfficeDocument(bytes)
    if (pages.length === 0) return { ok: false, skipped: 'empty' }
    return { ok: true, pages, reader: 'office', pageCount: pages.length }
  }

  const pages = readTextDocument(bytes, mimeType!)
  if (pages.length === 0) return { ok: false, skipped: 'empty' }
  return { ok: true, pages, reader, pageCount: 1 }
}

import type { SupabaseClient } from '@supabase/supabase-js'
import { downloadDocumentObject } from '@/lib/core/documents/document-service'
import { createLogger } from '@/lib/logger'
import { readDocumentBytes } from './router'
import { readerForMime, type ReadOutcome } from './types'

const log = createLogger('documents/read')

export interface ReadableDocumentRow {
  id: string
  company_id: string | null
  storage_path: string
  mime_type: string | null
}

export type StoreOutcome =
  | { status: 'read'; pages: number; reader: string }
  | { status: 'skipped'; reason: string }
  | { status: 'error'; reason: string }

/**
 * Read one document and store its pages. Idempotent: pages for the document
 * are replaced, and pages_read_at is stamped on every outcome so the backfill
 * moves on. Never touches the file itself.
 */
export async function readAndStoreDocument(supabase: SupabaseClient, doc: ReadableDocumentRow): Promise<StoreOutcome> {
  if (!doc.company_id) return stamp(supabase, doc.id, { status: 'skipped', reason: 'no_company' }, null)
  const kind = readerForMime(doc.mime_type)
  if (kind === null) return stamp(supabase, doc.id, { status: 'skipped', reason: 'unsupported_mime' }, null)
  if (kind === 'structured') return stamp(supabase, doc.id, { status: 'skipped', reason: 'structured' }, null)

  const { blob, error } = await downloadDocumentObject(supabase, doc.storage_path, doc.company_id)
  if (error || !blob) {
    return stamp(supabase, doc.id, { status: 'error', reason: `download_failed: ${error?.message ?? 'no data'}` }, null)
  }
  const bytes = Buffer.from(await blob.arrayBuffer())

  let outcome: ReadOutcome
  try {
    outcome = await readDocumentBytes(bytes, doc.mime_type)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    log.warn('read failed', { doc: doc.id, mime: doc.mime_type, reason })
    return stamp(supabase, doc.id, { status: 'error', reason: `read_failed: ${reason.slice(0, 300)}` }, null)
  }
  if (!outcome.ok) {
    // An unconfigured model is not a final state for a scan: leave the row
    // unstamped so a later run with AI configured picks it up.
    if (outcome.skipped === 'ai_unconfigured') return { status: 'skipped', reason: 'ai_unconfigured' }
    return stamp(supabase, doc.id, { status: 'skipped', reason: outcome.skipped }, 0)
  }

  const rows = outcome.pages.map((p) => ({
    company_id: doc.company_id,
    document_id: doc.id,
    page_no: p.pageNo,
    text: p.text,
    words: p.words ?? null,
    page_width: p.pageWidth ?? null,
    page_height: p.pageHeight ?? null,
    reader: p.reader,
    has_text_layer: p.hasTextLayer,
  }))
  const { error: delError } = await supabase.from('document_pages').delete().eq('document_id', doc.id)
  if (delError) return stamp(supabase, doc.id, { status: 'error', reason: `pages_delete_failed: ${delError.message}` }, null)
  const { error: insError } = await supabase.from('document_pages').insert(rows)
  if (insError) return stamp(supabase, doc.id, { status: 'error', reason: `pages_insert_failed: ${insError.message}` }, null)
  return stamp(supabase, doc.id, { status: 'read', pages: rows.length, reader: outcome.reader }, outcome.pageCount)
}

async function stamp(supabase: SupabaseClient, documentId: string, outcome: StoreOutcome, pageCount: number | null): Promise<StoreOutcome> {
  const readError = outcome.status === 'read' ? null : outcome.reason
  const { error } = await supabase
    .from('document_attachments')
    .update({ pages_read_at: new Date().toISOString(), page_count: pageCount, read_error: readError })
    .eq('id', documentId)
  if (error) log.warn('stamp failed', { doc: documentId, err: error.message })
  return outcome
}

/** Backfill: read the newest unread documents first. Returns what happened per document. */
export async function readUnreadDocuments(supabase: SupabaseClient, limit: number): Promise<{ processed: number; read: number; skipped: number; errors: number }> {
  const { data, error } = await supabase
    .from('document_attachments')
    .select('id, company_id, storage_path, mime_type')
    .is('pages_read_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`fetch unread documents failed: ${error.message}`)
  const counts = { processed: 0, read: 0, skipped: 0, errors: 0 }
  for (const doc of (data ?? []) as ReadableDocumentRow[]) {
    const out = await readAndStoreDocument(supabase, doc)
    counts.processed++
    if (out.status === 'read') counts.read++
    else if (out.status === 'skipped') counts.skipped++
    else counts.errors++
  }
  return counts
}

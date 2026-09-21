import type { SupabaseClient } from '@supabase/supabase-js'
import { downloadDocumentObject } from '@/lib/core/documents/document-service'
import { getAiStatus } from '@/lib/ai'
import { arkivRollout, isArkivEnabled } from '@/lib/arkiv/flag'
import { createLogger } from '@/lib/logger'
import { readDocumentBytes } from './router'
import { READER_UNAVAILABLE, ReaderUnavailableError, readerForMime, type ReadOutcome } from './types'

const log = createLogger('documents/read')

export interface ReadableDocumentRow {
  id: string
  company_id: string | null
  storage_path: string
  mime_type: string | null
}

export type StoreOutcome =
  | { status: 'read'; pages: number; reader: string; partial?: string }
  | { status: 'skipped'; reason: string }
  | { status: 'error'; reason: string }

export const isReaderUnavailable = (out: StoreOutcome) => out.status === 'error' && out.reason.startsWith(READER_UNAVAILABLE)

/** Reasons the backfill retries later: the model was gated or unconfigured when the row was read. */
const RETRY_REASONS = ['ai_gated', 'ai_unconfigured', 'partial:ai_gated', 'partial:ai_unconfigured']

/**
 * Read one document and store its pages. Idempotent: pages for the document
 * are replaced, and pages_read_at is stamped on every outcome about the
 * document so the backfill moves on (read_error names why when no or only some
 * pages were produced). A reader that could not be loaded is an outcome about
 * the environment: nothing is stamped and the document stays unread.
 * Never touches the file itself. The model is called only for companies in
 * the Arkiv rollout; text layers are read for everyone.
 */
export async function readAndStoreDocument(
  supabase: SupabaseClient,
  doc: ReadableDocumentRow,
  opts: { allowModel?: boolean } = {},
): Promise<StoreOutcome> {
  const allowModel = opts.allowModel ?? isArkivEnabled(doc.company_id)
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
    outcome = await readDocumentBytes(bytes, doc.mime_type, { allowModel })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    if (err instanceof ReaderUnavailableError) {
      // Not stamped: the document is fine, the reader is missing. It stays unread for the next run.
      log.warn('reader unavailable, document left unread', { doc: doc.id, mime: doc.mime_type, reason })
      return { status: 'error', reason: `${READER_UNAVAILABLE}: ${reason.slice(0, 300)}` }
    }
    log.warn('read failed', { doc: doc.id, mime: doc.mime_type, reason })
    return stamp(supabase, doc.id, { status: 'error', reason: `read_failed: ${reason.slice(0, 300)}` }, null)
  }
  if (!outcome.ok) {
    // Stamped with the reason: the backfill's retry pass picks ai_* rows up
    // again once the company is in the rollout and a model is configured.
    return stamp(supabase, doc.id, { status: 'skipped', reason: outcome.skipped }, 0)
  }

  const rows = outcome.pages.map((p) => ({
    company_id: doc.company_id,
    document_id: doc.id,
    page_no: p.pageNo,
    text: storableText(p.text),
    words: p.words ? p.words.map((w) => ({ ...w, t: storableText(w.t) })) : null,
    page_width: p.pageWidth ?? null,
    page_height: p.pageHeight ?? null,
    reader: p.reader,
    has_text_layer: p.hasTextLayer,
  }))
  const { error: delError } = await supabase.from('document_pages').delete().eq('document_id', doc.id)
  if (delError) return stamp(supabase, doc.id, { status: 'error', reason: `pages_delete_failed: ${delError.message}` }, null)
  const { error: insError } = await supabase.from('document_pages').insert(rows)
  if (insError) return stamp(supabase, doc.id, { status: 'error', reason: `pages_insert_failed: ${insError.message}` }, null)
  return stamp(
    supabase,
    doc.id,
    { status: 'read', pages: rows.length, reader: outcome.reader, ...(outcome.partial ? { partial: `partial:${outcome.partial}` } : {}) },
    outcome.pageCount,
  )
}

/**
 * What a reader found, made storable. Postgres holds no NUL in text and
 * rejects it (and an unpaired surrogate) inside jsonb with "unsupported
 * Unicode escape sequence"; some PDFs carry both in their text layer. Other
 * control characters go too: they are never content. Tabs and newlines stay.
 */
export function storableText(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD')
}

async function stamp(supabase: SupabaseClient, documentId: string, outcome: StoreOutcome, pageCount: number | null): Promise<StoreOutcome> {
  const readError = outcome.status === 'read' ? (outcome.partial ?? null) : outcome.reason
  const { error } = await supabase
    .from('document_attachments')
    .update({ pages_read_at: new Date().toISOString(), page_count: pageCount, read_error: readError })
    .eq('id', documentId)
  if (error) log.warn('stamp failed', { doc: documentId, err: error.message })
  return outcome
}

/**
 * Backfill, in the order someone is waiting: unread documents of the companies
 * in the rollout, then their documents whose model pages were gated or
 * unconfigured last time (only when a model is configured), then the newest
 * unread documents of everyone else. The platform holds far more unread files
 * than one run reads, so without that order a company switched on today waits
 * behind every other archive. budgetMs stops the batch between documents.
 */
export async function readUnreadDocuments(
  supabase: SupabaseClient,
  limit: number,
  opts: { budgetMs?: number } = {},
): Promise<{ processed: number; read: number; skipped: number; errors: number }> {
  const counts = { processed: 0, read: 0, skipped: 0, errors: 0 }
  const startedAt = Date.now()
  const spent = () => counts.processed >= limit || (opts.budgetMs !== undefined && Date.now() - startedAt >= opts.budgetMs)
  // False when the reader is missing: that fails every document the same way, so stop and try again next run.
  const walk = async (docs: ReadableDocumentRow[], readOpts?: { allowModel?: boolean }): Promise<boolean> => {
    for (const doc of docs) {
      if (spent()) return true
      const out = await readAndStoreDocument(supabase, doc, readOpts)
      counts.processed++
      if (out.status === 'read') counts.read++
      else if (out.status === 'skipped') counts.skipped++
      else counts.errors++
      if (isReaderUnavailable(out)) return false
    }
    return true
  }
  const rollout = arkivRollout()
  const companies = rollout === 'all' ? null : rollout

  if (companies && companies.length > 0) {
    const { data, error } = await supabase
      .from('document_attachments')
      .select('id, company_id, storage_path, mime_type')
      .is('pages_read_at', null)
      .in('company_id', companies)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw new Error(`fetch rollout documents failed: ${error.message}`)
    if (!(await walk((data ?? []) as ReadableDocumentRow[]))) return counts
  }

  if (!spent() && getAiStatus().configured && (companies === null || companies.length > 0)) {
    let retry = supabase
      .from('document_attachments')
      .select('id, company_id, storage_path, mime_type')
      .in('read_error', RETRY_REASONS)
    if (companies) retry = retry.in('company_id', companies)
    const { data, error } = await retry.order('pages_read_at', { ascending: true }).limit(limit - counts.processed)
    if (error) throw new Error(`fetch retry documents failed: ${error.message}`)
    if (!(await walk((data ?? []) as ReadableDocumentRow[], { allowModel: true }))) return counts
  }

  if (spent()) return counts
  const { data, error } = await supabase
    .from('document_attachments')
    .select('id, company_id, storage_path, mime_type')
    .is('pages_read_at', null)
    .order('created_at', { ascending: false })
    .limit(limit - counts.processed)
  if (error) throw new Error(`fetch unread documents failed: ${error.message}`)
  await walk((data ?? []) as ReadableDocumentRow[])
  return counts
}

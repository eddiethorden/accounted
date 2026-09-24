import { NextResponse } from 'next/server'
import { withCronContext } from '@/lib/api/with-cron-context'
import { createServiceRoleClient } from '@/lib/supabase/service-client'
import { readUnreadDocuments } from '@/lib/documents/read/store'
import { enqueueDocumentJob } from '@/lib/documents/jobs/queue'
import { isArkivEnabled } from '@/lib/arkiv/flag'
import { readLaneFor } from '@/lib/documents/read/lanes'

/**
 * GET /api/documents/read/cron
 * Arkiv backfill: reads documents that have no page text yet, the rollout
 * companies' first and each by its history lane (phase 9f), a bounded batch
 * per run. Every outcome stamps pages_read_at, so the batch never revisits a
 * row. The time budget leaves room for the last document's model pages inside
 * maxDuration. Authenticated by CRON_SECRET (withCronContext).
 */
export const maxDuration = 300

const BATCH = 40
const TIME_BUDGET_MS = 180_000

/**
 * Vision pages per company and day the backfill may spend on history (older than 30 days). Unset means no cap:
 * every document is read and typed whatever its age, so search, the folders and agents see one archive
 * (founder, 2026-09-24: cost is no problem, UX first). A number caps it; 0 reads history from text layers only.
 */
export function backfillPagesPerDay(): number {
  const raw = process.env.ARKIV_BACKFILL_PAGES_PER_DAY
  if (raw === undefined || raw.trim() === '') return Number.POSITIVE_INFINITY
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

export const GET = withCronContext('documents.read', async (_request, ctx) => {
  const supabase = createServiceRoleClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const budget = backfillPagesPerDay()
  const counts = await readUnreadDocuments(supabase, BATCH, {
    budgetMs: TIME_BUDGET_MS,
    budgetPagesPerDay: budget,
    // A document read here gets typed like one that arrived today; with the budget at 0, history stays untyped text.
    onRead: async (doc) => {
      if (!doc.company_id || doc.doc_type || !isArkivEnabled(doc.company_id)) return
      if (budget <= 0 && readLaneFor(doc) !== 'live') return
      try {
        await enqueueDocumentJob(supabase, doc.company_id, doc.id, 'classify')
      } catch (err) {
        ctx.log.warn('classify not queued after backfill read', { doc: doc.id, reason: err instanceof Error ? err.message : String(err) })
      }
    },
  })
  ctx.log.info('document read backfill', counts)
  return NextResponse.json({ ok: true, ...counts })
})

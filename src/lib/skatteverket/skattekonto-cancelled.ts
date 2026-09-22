import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchEntryLines, fetchLinesByEntryIds, type EntryLinesQuery } from '@/lib/bookkeeping/entry-lines'
import { roundOre } from '@/lib/money'
import { SKATTEKONTO_ACCOUNT } from './manual-verifikat-prefill'

/**
 * Which verifikat are cancelled in the ledger, and so can never settle a
 * skattekonto row?
 *
 * Two shapes carry the same meaning:
 *   1. Our own storno: the original is `reversed` (or carries reversed_by_id)
 *      and the storno entry carries reverses_id. Neither moved 1630 for real.
 *   2. An imported correction pair: Visma/Spiris, Fortnox and others export a
 *      "Korrigering av ver.nr. A177" as a separate posted verifikat whose lines
 *      are the original's with debit and credit swapped. SIE carries no link
 *      between the two, so both arrive as plain posted entries and the pair
 *      only shows in the numbers.
 *
 * Shape 2 is decided per cluster: every posted entry within
 * MIRROR_WINDOW_DAYS that has exactly E's lines (twins) or exactly E's lines
 * mirrored. The cluster cancels only when twins and mirrors are equally many,
 * i.e. the ledger nets it to zero; one payment plus one exact refund inside a
 * week reads the same way and is also excluded, which only turns a proposal
 * into "no candidate" (never a wrong link). Uneven clusters (two payments,
 * one reversal) are ambiguous and left alone.
 */

const MIRROR_WINDOW_DAYS = 7

interface EntryHead {
  id: string
  entry_date: string
  status: 'draft' | 'posted' | 'reversed'
  reverses_id: string | null
  reversed_by_id: string | null
}

interface Line {
  journal_entry_id: string
  account_number: string
  debit_amount: number | string
  credit_amount: number | string
}

/** Order-independent signature of an entry's lines; `mirrored` swaps the sides. */
export function lineSignature(
  lines: Array<Pick<Line, 'account_number' | 'debit_amount' | 'credit_amount'>>,
  mirrored = false,
): string {
  return lines
    .map((l) => {
      const debit = roundOre(Number(l.debit_amount || 0))
      const credit = roundOre(Number(l.credit_amount || 0))
      return mirrored ? `${l.account_number}|${credit}|${debit}` : `${l.account_number}|${debit}|${credit}`
    })
    .sort()
    .join(';')
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function daysApart(a: string, b: string): number {
  return Math.abs(
    Math.round((new Date(a + 'T00:00:00Z').getTime() - new Date(b + 'T00:00:00Z').getTime()) / 86_400_000),
  )
}

function groupLines(lines: Line[]): Map<string, Line[]> {
  const byEntry = new Map<string, Line[]>()
  for (const l of lines) {
    const list = byEntry.get(l.journal_entry_id) ?? []
    list.push(l)
    byEntry.set(l.journal_entry_id, list)
  }
  return byEntry
}

/**
 * Return the subset of `entryIds` that is cancelled (storno or an exact
 * imported correction pair). Best-effort on reads: a failed or empty read
 * cancels nothing, so the caller's existing strict amount checks still apply.
 */
export async function findCancelledEntryIds(
  supabase: SupabaseClient,
  companyId: string,
  entryIds: string[],
): Promise<Set<string>> {
  const cancelled = new Set<string>()
  const ids = [...new Set(entryIds)]
  if (ids.length === 0) return cancelled

  const { data: heads } = await supabase
    .from('journal_entries')
    .select('id, entry_date, status, reverses_id, reversed_by_id')
    .eq('company_id', companyId)
    .in('id', ids)
  const typedHeads = (heads ?? []) as EntryHead[]
  if (typedHeads.length === 0) return cancelled

  const open: EntryHead[] = []
  for (const h of typedHeads) {
    if (h.status === 'reversed' || h.reverses_id || h.reversed_by_id) cancelled.add(h.id)
    else open.push(h)
  }
  if (open.length === 0) return cancelled

  const ownLines = groupLines(
    await fetchLinesByEntryIds<Line & { id: string }>(
      supabase,
      open.map((h) => h.id),
      'account_number, debit_amount, credit_amount',
    ),
  )

  // Neighbours: posted entries near any candidate with a 1630 line. Only
  // those can be a twin or a mirror (both touch 1630 by definition).
  const dates = open.map((h) => h.entry_date).sort()
  type NeighbourLine = { journal_entry_id: string; journal_entries: { id: string; entry_date: string } }
  let neighbourLines: NeighbourLine[]
  try {
    neighbourLines = await fetchEntryLines<NeighbourLine>({
      supabase,
      entryColumns: 'id, entry_date',
      lineColumns: 'journal_entry_id',
      filterEntries: (q: EntryLinesQuery) =>
        q
          .eq('company_id', companyId)
          .eq('status', 'posted')
          .gte('entry_date', addDays(dates[0], -MIRROR_WINDOW_DAYS))
          .lte('entry_date', addDays(dates[dates.length - 1], MIRROR_WINDOW_DAYS)),
      filterLines: (q: EntryLinesQuery) => q.eq('account_number', SKATTEKONTO_ACCOUNT),
    })
  } catch {
    return cancelled
  }
  const neighbourDate = new Map<string, string>()
  for (const l of neighbourLines) neighbourDate.set(l.journal_entries.id, l.journal_entries.entry_date)
  if (neighbourDate.size === 0) return cancelled

  const neighbourIds = [...neighbourDate.keys()].filter((id) => !ownLines.has(id))
  const allLines = new Map(ownLines)
  if (neighbourIds.length > 0) {
    const extra = groupLines(
      await fetchLinesByEntryIds<Line & { id: string }>(
        supabase,
        neighbourIds,
        'account_number, debit_amount, credit_amount',
      ),
    )
    for (const [id, lines] of extra) allLines.set(id, lines)
  }

  const signatureOf = new Map<string, string>()
  for (const [id, lines] of allLines) signatureOf.set(id, lineSignature(lines))

  for (const h of open) {
    const lines = ownLines.get(h.id)
    if (!lines || lines.length === 0) continue
    const own = lineSignature(lines)
    const mirror = lineSignature(lines, true)
    if (own === mirror) continue
    let twins = 0
    let mirrors = 0
    for (const [id, date] of neighbourDate) {
      if (daysApart(date, h.entry_date) > MIRROR_WINDOW_DAYS) continue
      const sig = signatureOf.get(id)
      if (sig === own) twins++
      else if (sig === mirror) mirrors++
    }
    // The candidate itself is posted and touches 1630, so it counts as a
    // twin when it is in the neighbour read; a draft candidate is not.
    if (!neighbourDate.has(h.id)) twins++
    if (mirrors > 0 && mirrors === twins) cancelled.add(h.id)
  }

  return cancelled
}

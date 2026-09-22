import type { SupabaseClient } from '@supabase/supabase-js'
import type { StoredSkattekontoTransaction } from '../types'
import { fetchEntryLines, type EntryLinesQuery } from '@/lib/bookkeeping/entry-lines'
import { roundOre } from '@/lib/money'
import { SKATTEKONTO_ACCOUNT } from '@/lib/skatteverket/manual-verifikat-prefill'
import { findCancelledEntryIds } from '@/lib/skatteverket/skattekonto-cancelled'

/**
 * "Matcha mot befintligt verifikat"-flöde för skattekonto-rader.
 *
 * Jacob's use case:
 *   16/3: User books a manual transfer (D 1630 / C 1930, X kr) when they
 *         pay preliminärskatt from the bank.
 *   17/3: Skatteverket reports the same payment landing on skattekontot.
 *
 * Without matching, the per-row Bokför button would create a *second*
 * verifikat with the same 1630-leg → double-counted cash flow. This module
 * finds the existing entry; the link itself (no new draft) is the core
 * linkSkattekontoRows in lib/skatteverket/skattekonto-link.ts.
 *
 * The candidate query is intentionally strict (exact amount, exact side,
 * unused entry): false positives would be silently destructive. False
 * negatives just fall back to "Bokför / Skapa manuellt".
 *
 * AGI period disambiguation: when transaktionstext carries an explicit period
 * token (e.g. "Arbetsgivardeklaration 202605"), the AGI declaration for that
 * period uniquely identifies the salary_run, and from there the salary entries.
 * That lets the matcher prefer the right entry even when two months happen to
 * have identical totals.
 */

const DATE_WINDOW_DAYS = 14

export class SkattekontoMatchError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'TRANSACTION_NOT_FOUND'
      | 'ALREADY_BOOKED'
      | 'ROW_IGNORED'
      | 'ENTRY_NOT_FOUND'
      | 'ENTRY_ALREADY_LINKED'
      | 'INVALID_CANDIDATE',
  ) {
    super(message)
    this.name = 'SkattekontoMatchError'
  }
}

export interface SkattekontoMatchCandidate {
  journal_entry_id: string
  voucher_number: number | null
  voucher_series: string | null
  entry_date: string
  description: string
  status: 'draft' | 'posted' | 'reversed'
  matched_amount: number
  matched_side: 'debit' | 'credit'
  /**
   * True when this candidate was picked because the SKV transaktionstext carried
   * an AGI period code matching the originating salary run. Used by the UI to
   * show a "period-matched" badge.
   */
  matched_via_agi_period?: boolean
  /**
   * True when no single 1630 line equals the amount but the entry's 1630
   * lines NET to it (a manual voucher that split the movement over two
   * lines). The link still settles the whole entry, so the pair closes.
   */
  matched_via_entry_total?: boolean
  /**
   * Set when the verifikat settles this row only TOGETHER with other rows:
   * one combined 1630 line for avdragen skatt + arbetsgivaravgift, or a
   * verifikat that already carries the other half of its 1630 movement.
   * `link_transaction_ids` is what the link call must send (this row plus
   * any open siblings); `group_rows` are the other rows, for display.
   * 'new': the siblings get linked together with this row. 'join': the other
   * rows are already linked and this row completes the verifikat.
   */
  group?: {
    mode: 'new' | 'join'
    link_transaction_ids: string[]
    group_rows: Array<{
      id: string
      transaktionsdatum: string
      transaktionstext: string | null
      belopp_skatteverket: number
    }>
  }
}

/** Swedish month names exactly as SKV writes them in prod transaktionstext. */
export const SWEDISH_MONTH_NUMBERS: Record<string, number> = {
  januari: 1,
  februari: 2,
  mars: 3,
  april: 4,
  maj: 5,
  juni: 6,
  juli: 7,
  augusti: 8,
  september: 9,
  oktober: 10,
  november: 11,
  december: 12,
}

const MONTH_NAME_ALTERNATION = Object.keys(SWEDISH_MONTH_NUMBERS).join('|')

// Production skattekonto rows write the period as "<keyword> <månad> <år>"
// ("Avdragen skatt maj 2026", "Arbetsgivaravgift maj 2026"); the numeric
// "Arbetsgivardeklaration 202605" form is what the SKV test environment uses.
const MONTH_NAME_PERIOD_RE = new RegExp(
  `(?:arbetsgivardeklaration|arbetsgivaravgift|avdragen skatt|\\bagi\\b)\\s+(${MONTH_NAME_ALTERNATION})\\s+(\\d{4})\\b`,
  'i',
)

/**
 * Parse an AGI period from a Skatteverket transaktionstext.
 *
 * Examples that match:
 *   "Arbetsgivardeklaration 202605"      (test environment)
 *   "arbetsgivardeklaration 2026-05"
 *   "AGI 202605"
 *   "Avdragen skatt maj 2026"            (production)
 *   "Arbetsgivaravgift maj 2026"         (production)
 *   "Beslut 260703 arbetsgivaravgift mars 2026"  (production beslut rows)
 *
 * Beslut rows parsing to their period is intentional (audited): it lets match
 * suggestions period-boost correction rows too. This is safe because (a) the
 * settlement module never uses parseAgiPeriod; it classifies with its own
 * start-anchored regexes and parseNumericAgiPeriod only, so a beslut row can
 * never mark a period paid, and (b) the only production callers are
 * findMatchSuggestionsBulk and findMatchCandidates in this file, both of which
 * require an exact amount+side match on a 1630 line before suggesting anything,
 * so a beslut row can only ever be suggested against an entry carrying exactly
 * the beslut's amount.
 *
 * Returns null when no period token is present or the value is out of range.
 */
export function parseAgiPeriod(
  transaktionstext: string,
): { year: number; month: number } | null {
  return (
    parseNumericAgiPeriod(transaktionstext) ??
    parseMonthNameAgiPeriod(transaktionstext)
  )
}

/**
 * The numeric-token subset of parseAgiPeriod ("Arbetsgivardeklaration 202605",
 * "AGI 2026-05"). Exported separately because the settlement's combined-row
 * classifier must stay pinned to this form: the month-name form always means
 * the split tax/avgift rows, which settle pairwise.
 *
 * The fallback (numeric YYYYMM after any AGI keyword) covers older SKV variants
 * that omit the leading word but still place the period adjacent to "AGI" or
 * "arbetsgivaravgift" elsewhere in the row.
 */
export function parseNumericAgiPeriod(
  transaktionstext: string,
): { year: number; month: number } | null {
  const text = transaktionstext.toLowerCase()

  const primary = /arbetsgivardeklaration\s*(\d{4})[-]?(\d{2})/i.exec(transaktionstext)
  if (primary) {
    const year = Number(primary[1])
    const month = Number(primary[2])
    if (isValidPeriod(year, month)) return { year, month }
  }

  const agiKeyword = /(arbetsgivardeklaration|arbetsgivaravgift|personalskatt|a-skatt|\bagi\b)/i
  if (!agiKeyword.test(text)) return null

  const fallback = /(\d{4})[-]?(\d{2})\b/.exec(transaktionstext)
  if (fallback) {
    const year = Number(fallback[1])
    const month = Number(fallback[2])
    if (isValidPeriod(year, month)) return { year, month }
  }

  return null
}

function parseMonthNameAgiPeriod(
  transaktionstext: string,
): { year: number; month: number } | null {
  const m = MONTH_NAME_PERIOD_RE.exec(transaktionstext)
  if (!m) return null
  const month = SWEDISH_MONTH_NUMBERS[m[1].toLowerCase()]
  const year = Number(m[2])
  if (month && isValidPeriod(year, month)) return { year, month }
  return null
}

function isValidPeriod(year: number, month: number): boolean {
  return Number.isFinite(year) && Number.isFinite(month)
    && year >= 2000 && year <= 2100
    && month >= 1 && month <= 12
}

interface AgiEntryLookup {
  /** Set of journal_entry_ids that belong to the AGI's salary run for that period. */
  entryIds: Set<string>
}

/**
 * Resolve AGI-linked journal entries for a set of (year, month) periods.
 *
 * For each period: look up agi_declarations (UNIQUE per company per period), then
 * walk salary_runs.salary_entry_id / avgifter_entry_id / vacation_entry_id. Any
 * of those three entries is a legitimate match target for an SKV row carrying
 * the period code.
 */
async function loadAgiEntryIndex(
  supabase: SupabaseClient,
  companyId: string,
  periods: Array<{ year: number; month: number }>,
): Promise<Map<string, AgiEntryLookup>> {
  const index = new Map<string, AgiEntryLookup>()
  if (periods.length === 0) return index

  const uniqueKeys = new Set(periods.map(p => periodKey(p.year, p.month)))
  if (uniqueKeys.size === 0) return index

  const years = Array.from(new Set(periods.map(p => p.year)))
  const months = Array.from(new Set(periods.map(p => p.month)))

  const { data: agiRows } = await supabase
    .from('agi_declarations')
    .select('period_year, period_month, salary_run_id')
    .eq('company_id', companyId)
    .in('period_year', years)
    .in('period_month', months)

  const salaryRunIdsByPeriod = new Map<string, string[]>()
  for (const row of (agiRows ?? []) as Array<{
    period_year: number
    period_month: number
    salary_run_id: string | null
  }>) {
    if (!row.salary_run_id) continue
    const key = periodKey(row.period_year, row.period_month)
    if (!uniqueKeys.has(key)) continue
    const existing = salaryRunIdsByPeriod.get(key) ?? []
    existing.push(row.salary_run_id)
    salaryRunIdsByPeriod.set(key, existing)
  }

  const allSalaryRunIds = Array.from(
    new Set(Array.from(salaryRunIdsByPeriod.values()).flat()),
  )
  if (allSalaryRunIds.length === 0) return index

  const { data: salaryRows } = await supabase
    .from('salary_runs')
    .select('id, salary_entry_id, avgifter_entry_id, vacation_entry_id')
    .eq('company_id', companyId)
    .in('id', allSalaryRunIds)

  const entryIdsByRun = new Map<string, string[]>()
  for (const row of (salaryRows ?? []) as Array<{
    id: string
    salary_entry_id: string | null
    avgifter_entry_id: string | null
    vacation_entry_id: string | null
  }>) {
    const ids = [row.salary_entry_id, row.avgifter_entry_id, row.vacation_entry_id]
      .filter((id): id is string => !!id)
    entryIdsByRun.set(row.id, ids)
  }

  for (const [key, runIds] of salaryRunIdsByPeriod) {
    const entryIds = new Set<string>()
    for (const runId of runIds) {
      for (const id of entryIdsByRun.get(runId) ?? []) entryIds.add(id)
    }
    if (entryIds.size > 0) index.set(key, { entryIds })
  }

  return index
}

function periodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

/**
 * Bulk-enrich a list of unmatched SKV rows with a `match_suggestion` field
 * pointing to a "high confidence" candidate verifikat.
 *
 * Matching has two layers:
 *   1. AGI period-code disambiguation. If the transaktionstext carries a period
 *      token and the AGI declaration for that period maps to journal entries,
 *      the matcher prefers candidates from that set even when other amount
 *      matches exist.
 *   2. Strict amount+side match. We auto-suggest only when there is EXACTLY ONE
 *      candidate to avoid silently linking the wrong entry.
 */
export async function findMatchSuggestionsBulk(
  supabase: SupabaseClient,
  companyId: string,
  rows: Array<{
    id: string
    transaktionsdatum: string
    transaktionstext?: string | null
    belopp_skatteverket: number
    journal_entry_id: string | null
  }>,
): Promise<Map<string, SkattekontoMatchCandidate>> {
  const unmatched = rows.filter(r => !r.journal_entry_id)
  if (unmatched.length === 0) return new Map()

  const dates = unmatched.map(r => r.transaktionsdatum).sort()
  const from = addDays(dates[0], -DATE_WINDOW_DAYS)
  const to = addDays(dates[dates.length - 1], DATE_WINDOW_DAYS)

  type Row = {
    debit_amount: number
    credit_amount: number
    journal_entries: {
      id: string
      voucher_number: number | null
      voucher_series: string | null
      entry_date: string
      description: string
      status: 'draft' | 'posted' | 'reversed'
      company_id: string
    }
  }

  // Driven from the journal_entries side (lib/bookkeeping/entry-lines.ts):
  // the scope filters used to sit on a `journal_entries!inner` embed, which
  // PostgREST compiles into a correlated LATERAL join that walks the ENTIRE
  // journal_entry_lines table across all tenants. The parent is reattached
  // under the same `journal_entries` key, so the candidate build is unchanged.
  let lines: Row[]
  try {
    lines = await fetchEntryLines<Row>({
      supabase,
      entryColumns: 'id, voucher_number, voucher_series, entry_date, description, status, company_id',
      lineColumns: 'debit_amount, credit_amount',
      filterEntries: (q: EntryLinesQuery) =>
        q
          .eq('company_id', companyId)
          .gte('entry_date', from)
          .lte('entry_date', to)
          .neq('status', 'reversed'),
      filterLines: (q: EntryLinesQuery) => q.eq('account_number', SKATTEKONTO_ACCOUNT),
    })
  } catch {
    // Unchanged posture: a candidate-search failure yields no suggestions.
    return new Map()
  }

  // Filter out entries already linked to another SKV row.
  const candidateEntryIds = Array.from(new Set(lines.map(l => l.journal_entries.id)))
  const { data: linked } = candidateEntryIds.length
    ? await supabase
        .from('skattekonto_transactions')
        .select('journal_entry_id')
        .eq('company_id', companyId)
        .in('journal_entry_id', candidateEntryIds)
    : { data: [] }

  const linkedSet = new Set(
    (linked ?? [])
      .map((l: { journal_entry_id: string | null }) => l.journal_entry_id)
      .filter((id): id is string => !!id),
  )

  // AGI period extraction across the batch.
  const periods: Array<{ year: number; month: number }> = []
  const periodByRowId = new Map<string, string>()
  for (const row of unmatched) {
    if (!row.transaktionstext) continue
    const period = parseAgiPeriod(row.transaktionstext)
    if (!period) continue
    periods.push(period)
    periodByRowId.set(row.id, periodKey(period.year, period.month))
  }
  const agiIndex = await loadAgiEntryIndex(supabase, companyId, periods)

  // A storno'd verifikat or an imported correction pair never moved 1630, so
  // its line is no twin of anything (crm#128: the proposal pointed at A177,
  // which A178 cancels line for line).
  const cancelled = await findCancelledEntryIds(
    supabase,
    companyId,
    candidateEntryIds.filter(id => !linkedSet.has(id)),
  )

  // Per-entry view of the 1630 movement: which single lines exist, and what
  // the entry nets to. The net is the entry-level fallback for a manual
  // voucher that split one SKV event over two 1630 lines.
  type EntryView = {
    entry: Row['journal_entries']
    debits: number[]
    credits: number[]
    net: number
    lineCount: number
  }
  const entryViews = new Map<string, EntryView>()
  for (const line of lines) {
    const e = line.journal_entries
    if (linkedSet.has(e.id) || cancelled.has(e.id)) continue
    const debit = roundOre(Number(line.debit_amount))
    const credit = roundOre(Number(line.credit_amount))
    let view = entryViews.get(e.id)
    if (!view) {
      view = { entry: e, debits: [], credits: [], net: 0, lineCount: 0 }
      entryViews.set(e.id, view)
    }
    if (debit > 0 && credit === 0) view.debits.push(debit)
    if (credit > 0 && debit === 0) view.credits.push(credit)
    view.net = roundOre(view.net + debit - credit)
    view.lineCount++
  }

  // Candidates per row, then a one-to-one assignment across rows: two rows
  // that each see "exactly one candidate" must not both be proposed the same
  // verifikat (12 same-day-same-amount groups on prod would have done that).
  // Rows are assigned in date order; AGI-period matches win inside a row.
  const ordered = [...unmatched].sort((a, b) =>
    a.transaktionsdatum < b.transaktionsdatum
      ? -1
      : a.transaktionsdatum > b.transaktionsdatum
        ? 1
        : a.id < b.id
          ? -1
          : a.id > b.id
            ? 1
            : 0,
  )
  const candidatesByRow = new Map<string, SkattekontoMatchCandidate[]>()
  const periodIdsByRow = new Map<string, Set<string> | null>()

  for (const row of ordered) {
    const amount = Math.round(Math.abs(Number(row.belopp_skatteverket)) * 100) / 100
    const side = expectedSide(Number(row.belopp_skatteverket))
    const signedNet = side === 'debit' ? amount : -amount
    const rowFrom = addDays(row.transaktionsdatum, -DATE_WINDOW_DAYS)
    const rowTo = addDays(row.transaktionsdatum, DATE_WINDOW_DAYS)

    const periodEntryIds = (() => {
      const key = periodByRowId.get(row.id)
      return key ? agiIndex.get(key)?.entryIds ?? null : null
    })()
    periodIdsByRow.set(row.id, periodEntryIds)

    const matches: SkattekontoMatchCandidate[] = []
    for (const view of entryViews.values()) {
      const e = view.entry
      if (e.entry_date < rowFrom || e.entry_date > rowTo) continue
      const singleLine =
        side === 'debit' ? view.debits.includes(amount) : view.credits.includes(amount)
      const entryTotal = !singleLine && view.lineCount > 1 && view.net === signedNet
      if (!singleLine && !entryTotal) continue
      matches.push({
        journal_entry_id: e.id,
        voucher_number: e.voucher_number,
        voucher_series: e.voucher_series,
        entry_date: e.entry_date,
        description: e.description,
        status: e.status,
        matched_amount: amount,
        matched_side: side,
        matched_via_agi_period: periodEntryIds?.has(e.id) ?? false,
        matched_via_entry_total: entryTotal,
      })
    }
    // Nearest date first so the assignment below is deterministic.
    matches.sort((a, b) => {
      const da = Math.abs(daysBetweenIso(a.entry_date, row.transaktionsdatum))
      const db = Math.abs(daysBetweenIso(b.entry_date, row.transaktionsdatum))
      return da - db || a.journal_entry_id.localeCompare(b.journal_entry_id)
    })
    candidatesByRow.set(row.id, matches)
  }

  const suggestions = new Map<string, SkattekontoMatchCandidate>()
  const usedEntries = new Set<string>()

  const pick = (row: (typeof ordered)[number]): SkattekontoMatchCandidate | null => {
    const free = (candidatesByRow.get(row.id) ?? []).filter(m => !usedEntries.has(m.journal_entry_id))
    const periodEntryIds = periodIdsByRow.get(row.id)
    if (periodEntryIds) {
      const periodMatches = free.filter(m => m.matched_via_agi_period)
      if (periodMatches.length === 1) return periodMatches[0]
    }
    // Only an unambiguous amount match is proposed; a split-line match never
    // outranks a single-line one.
    const exact = free.filter(m => !m.matched_via_entry_total)
    if (exact.length === 1) return exact[0]
    if (exact.length === 0 && free.length === 1) return free[0]
    return null
  }

  // Two passes: rows with an AGI period are the best-informed and go first,
  // then everyone else in date order.
  for (const pass of [true, false]) {
    for (const row of ordered) {
      if (suggestions.has(row.id)) continue
      const hasPeriod = !!periodIdsByRow.get(row.id)
      if (hasPeriod !== pass) continue
      const chosen = pick(row)
      if (!chosen) continue
      suggestions.set(row.id, chosen)
      usedEntries.add(chosen.journal_entry_id)
    }
  }

  return suggestions
}

function daysBetweenIso(a: string, b: string): number {
  const ms = new Date(a + 'T00:00:00Z').getTime() - new Date(b + 'T00:00:00Z').getTime()
  return Math.round(ms / 86_400_000)
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function expectedSide(beloppSkatteverket: number): 'debit' | 'credit' {
  // Positive SKV amount = money INTO skattekonto = 1630 increases = DEBIT 1630
  // Negative SKV amount = money OUT of skattekonto = 1630 decreases = CREDIT 1630
  return beloppSkatteverket > 0 ? 'debit' : 'credit'
}

/**
 * Find existing journal entries that look like the bank side of this
 * skattekonto row.
 *
 * Returns up to 25 candidates ordered by AGI-period match, then date proximity
 * to the SKV row.
 */
export async function findMatchCandidates(
  supabase: SupabaseClient,
  companyId: string,
  transactionId: string,
): Promise<{ tx: StoredSkattekontoTransaction; candidates: SkattekontoMatchCandidate[] }> {
  const { data: tx, error: txError } = await supabase
    .from('skattekonto_transactions')
    .select('*')
    .eq('id', transactionId)
    .eq('company_id', companyId)
    .single<StoredSkattekontoTransaction>()

  if (txError || !tx) {
    throw new SkattekontoMatchError(
      'Skattekonto-transaktionen hittades inte.',
      'TRANSACTION_NOT_FOUND',
    )
  }

  if (tx.journal_entry_id) {
    throw new SkattekontoMatchError(
      'Transaktionen är redan kopplad till ett verifikat.',
      'ALREADY_BOOKED',
    )
  }

  const amount = Math.round(Math.abs(Number(tx.belopp_skatteverket)) * 100) / 100
  const side = expectedSide(Number(tx.belopp_skatteverket))
  const from = addDays(tx.transaktionsdatum, -DATE_WINDOW_DAYS)
  const to = addDays(tx.transaktionsdatum, DATE_WINDOW_DAYS)

  type Row = {
    debit_amount: number
    credit_amount: number
    journal_entries: {
      id: string
      voucher_number: number | null
      voucher_series: string | null
      entry_date: string
      description: string
      status: 'draft' | 'posted' | 'reversed'
      company_id: string
    }
  }

  // 1630-lines with the right amount + side, scoped to entries in the date
  // window. The scope used to sit on a `journal_entries!inner` embed, which
  // PostgREST compiles into a correlated LATERAL join that walks the ENTIRE
  // journal_entry_lines table across all tenants (see
  // lib/bookkeeping/entry-lines.ts). The old `.limit(50)` went with it: the
  // amount+side match is exact, so the candidate set is already tiny.
  let typedRows: Row[]
  try {
    typedRows = await fetchEntryLines<Row>({
      supabase,
      entryColumns: 'id, voucher_number, voucher_series, entry_date, description, status, company_id',
      lineColumns: 'debit_amount, credit_amount',
      filterEntries: (q: EntryLinesQuery) =>
        q
          .eq('company_id', companyId)
          .gte('entry_date', from)
          .lte('entry_date', to)
          .neq('status', 'reversed'),
      filterLines: (q: EntryLinesQuery) => {
        const scoped = q.eq('account_number', SKATTEKONTO_ACCOUNT)
        return side === 'debit'
          ? scoped.eq('debit_amount', amount).eq('credit_amount', 0)
          : scoped.eq('credit_amount', amount).eq('debit_amount', 0)
      },
    })
  } catch (err) {
    throw new Error(
      `Kunde inte söka kandidater: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  // Filter out entries already linked to another skattekonto_transactions
  // row: those represent payments we've already accounted for.
  const candidateEntryIds = Array.from(new Set(typedRows.map(r => r.journal_entries.id)))
  const { data: linked } = candidateEntryIds.length
    ? await supabase
        .from('skattekonto_transactions')
        .select('journal_entry_id')
        .eq('company_id', companyId)
        .in('journal_entry_id', candidateEntryIds)
    : { data: [] }

  const linkedSet = new Set(
    (linked ?? [])
      .map((l: { journal_entry_id: string | null }) => l.journal_entry_id)
      .filter((id): id is string => !!id),
  )

  // Resolve AGI-linked entries for this single row's period (if any).
  const period = tx.transaktionstext ? parseAgiPeriod(tx.transaktionstext) : null
  const agiIndex = period
    ? await loadAgiEntryIndex(supabase, companyId, [period])
    : new Map<string, AgiEntryLookup>()
  const periodEntryIds = period
    ? agiIndex.get(periodKey(period.year, period.month))?.entryIds ?? null
    : null

  const seen = new Set<string>()
  const candidates: SkattekontoMatchCandidate[] = []
  for (const row of typedRows) {
    const e = row.journal_entries
    if (linkedSet.has(e.id)) continue
    if (seen.has(e.id)) continue
    seen.add(e.id)
    candidates.push({
      journal_entry_id: e.id,
      voucher_number: e.voucher_number,
      voucher_series: e.voucher_series,
      entry_date: e.entry_date,
      description: e.description,
      status: e.status,
      matched_amount: amount,
      matched_side: side,
      matched_via_agi_period: periodEntryIds?.has(e.id) ?? false,
    })
  }

  // Order: AGI-period match first, then date proximity, then voucher number desc.
  const target = new Date(tx.transaktionsdatum + 'T00:00:00Z').getTime()
  candidates.sort((a, b) => {
    if (a.matched_via_agi_period !== b.matched_via_agi_period) {
      return a.matched_via_agi_period ? -1 : 1
    }
    const da = Math.abs(new Date(a.entry_date + 'T00:00:00Z').getTime() - target)
    const db = Math.abs(new Date(b.entry_date + 'T00:00:00Z').getTime() - target)
    if (da !== db) return da - db
    return (b.voucher_number ?? 0) - (a.voucher_number ?? 0)
  })

  // A storno'd verifikat or an imported correction pair never moved 1630.
  const cancelledTwins = await findCancelledEntryIds(
    supabase,
    companyId,
    candidates.map(c => c.journal_entry_id),
  )
  const twins = candidates.filter(c => !cancelledTwins.has(c.journal_entry_id))
  if (twins.length > 0) return { tx, candidates: twins.slice(0, 25) }

  // A combined or partly linked verifikat is only offered when no live
  // verifikat carries the row's amount on a line of its own: the exact twin
  // stays the unambiguous answer.
  const groups = await findGroupCandidates(supabase, companyId, tx, period, periodEntryIds)
  if (groups.length === 0) return { tx, candidates: [] }
  const cancelledGroups = await findCancelledEntryIds(
    supabase,
    companyId,
    groups.map(c => c.journal_entry_id),
  )
  return {
    tx,
    candidates: groups.filter(c => !cancelledGroups.has(c.journal_entry_id)).slice(0, 25),
  }
}

/** How many open neighbour rows a combined verifikat may be split across. */
const MAX_GROUP_SIBLINGS = 3
/** Nearest open neighbour rows considered for a combined verifikat. */
const SIBLING_POOL = 12

type SiblingRow = {
  id: string
  transaktionsdatum: string
  transaktionstext: string | null
  belopp_skatteverket: number | string
  journal_entry_id: string | null
}

/**
 * Verifikat that settle this row together with other rows (crm#128, #104):
 *
 *   join: the verifikat already has rows linked and this row makes their sum
 *         equal its 1630 net (payment in and F-skatt drawn in one verifikat).
 *   new:  the verifikat is unlinked and its 1630 net equals this row plus a
 *         unique set of up to MAX_GROUP_SIBLINGS open rows nearby (Spiris and
 *         Bokio book avdragen skatt + arbetsgivaravgift as ONE 1630 line).
 *
 * The date window reaches back to the first day of the row's AGI period when
 * the text names one: tax for "maj 2026" is often booked in May by the old
 * system but drawn by Skatteverket on 12 June, outside ±14 days. An ambiguous
 * sibling set is never offered: the user books or links by hand instead.
 */
async function findGroupCandidates(
  supabase: SupabaseClient,
  companyId: string,
  tx: StoredSkattekontoTransaction,
  period: { year: number; month: number } | null,
  periodEntryIds: Set<string> | null,
): Promise<SkattekontoMatchCandidate[]> {
  const rowAmount = roundOre(Number(tx.belopp_skatteverket))
  const periodStart = period ? `${periodKey(period.year, period.month)}-01` : null
  const windowFrom = addDays(tx.transaktionsdatum, -DATE_WINDOW_DAYS)
  const from = periodStart && periodStart < windowFrom ? periodStart : windowFrom
  const to = addDays(tx.transaktionsdatum, DATE_WINDOW_DAYS)

  type Row = {
    debit_amount: number
    credit_amount: number
    journal_entries: {
      id: string
      voucher_number: number | null
      voucher_series: string | null
      entry_date: string
      description: string
      status: 'draft' | 'posted' | 'reversed'
    }
  }
  let lines: Row[]
  try {
    lines = await fetchEntryLines<Row>({
      supabase,
      entryColumns: 'id, voucher_number, voucher_series, entry_date, description, status',
      lineColumns: 'debit_amount, credit_amount',
      filterEntries: (q: EntryLinesQuery) =>
        q
          .eq('company_id', companyId)
          .gte('entry_date', from)
          .lte('entry_date', to)
          .neq('status', 'reversed'),
      filterLines: (q: EntryLinesQuery) => q.eq('account_number', SKATTEKONTO_ACCOUNT),
    })
  } catch {
    return []
  }
  if (lines.length === 0) return []

  const entries = new Map<string, { entry: Row['journal_entries']; net: number }>()
  for (const l of lines) {
    const view = entries.get(l.journal_entries.id) ?? { entry: l.journal_entries, net: 0 }
    view.net = roundOre(view.net + Number(l.debit_amount || 0) - Number(l.credit_amount || 0))
    entries.set(l.journal_entries.id, view)
  }

  const { data: linkedData } = await supabase
    .from('skattekonto_transactions')
    .select('id, transaktionsdatum, transaktionstext, belopp_skatteverket, journal_entry_id')
    .eq('company_id', companyId)
    .in('journal_entry_id', [...entries.keys()])
  const linkedByEntry = new Map<string, SiblingRow[]>()
  for (const r of (linkedData ?? []) as SiblingRow[]) {
    if (!r.journal_entry_id) continue
    const list = linkedByEntry.get(r.journal_entry_id) ?? []
    list.push(r)
    linkedByEntry.set(r.journal_entry_id, list)
  }

  const { data: siblingData } = await supabase
    .from('skattekonto_transactions')
    .select('id, transaktionsdatum, transaktionstext, belopp_skatteverket, journal_entry_id')
    .eq('company_id', companyId)
    .eq('status', 'booked')
    .eq('is_ignored', false)
    .is('journal_entry_id', null)
    .neq('id', tx.id)
    .gte('transaktionsdatum', addDays(tx.transaktionsdatum, -DATE_WINDOW_DAYS))
    .lte('transaktionsdatum', to)
  const siblings = ((siblingData ?? []) as SiblingRow[])
    .filter(r => r.id !== tx.id && !r.journal_entry_id)
    .sort((a, b) =>
      Math.abs(daysBetweenIso(a.transaktionsdatum, tx.transaktionsdatum))
        - Math.abs(daysBetweenIso(b.transaktionsdatum, tx.transaktionsdatum))
      || a.id.localeCompare(b.id),
    )
    .slice(0, SIBLING_POOL)

  const subsetsBySum = new Map<number, SiblingRow[][]>()
  const walk = (start: number, picked: SiblingRow[], sum: number) => {
    if (picked.length > 0) {
      const list = subsetsBySum.get(sum) ?? []
      list.push([...picked])
      subsetsBySum.set(sum, list)
    }
    if (picked.length === MAX_GROUP_SIBLINGS) return
    for (let i = start; i < siblings.length; i++) {
      picked.push(siblings[i])
      walk(i + 1, picked, roundOre(sum + Number(siblings[i].belopp_skatteverket)))
      picked.pop()
    }
  }
  walk(0, [], 0)

  const toDisplay = (r: SiblingRow) => ({
    id: r.id,
    transaktionsdatum: r.transaktionsdatum,
    transaktionstext: r.transaktionstext,
    belopp_skatteverket: Number(r.belopp_skatteverket),
  })

  const out: SkattekontoMatchCandidate[] = []
  for (const { entry, net } of entries.values()) {
    if (net === 0) continue
    const linked = linkedByEntry.get(entry.id) ?? []
    const linkedSum = roundOre(linked.reduce((s, r) => s + Number(r.belopp_skatteverket), 0))
    let group: SkattekontoMatchCandidate['group'] | undefined
    if (linked.length === 0 && net === rowAmount) {
      // Split over several 1630 lines that net to this row alone: a plain
      // entry-total candidate, no group needed.
      group = undefined
    } else if (linked.length > 0) {
      if (linkedSum === net || roundOre(linkedSum + rowAmount) !== net) continue
      group = { mode: 'join', link_transaction_ids: [tx.id], group_rows: linked.map(toDisplay) }
    } else {
      const matches = subsetsBySum.get(roundOre(net - rowAmount)) ?? []
      if (matches.length !== 1) continue
      group = {
        mode: 'new',
        link_transaction_ids: [tx.id, ...matches[0].map(r => r.id)],
        group_rows: matches[0].map(toDisplay),
      }
    }
    out.push({
      journal_entry_id: entry.id,
      voucher_number: entry.voucher_number,
      voucher_series: entry.voucher_series,
      entry_date: entry.entry_date,
      description: entry.description,
      status: entry.status,
      matched_amount: Math.abs(net),
      matched_side: net > 0 ? 'debit' : 'credit',
      matched_via_agi_period: periodEntryIds?.has(entry.id) ?? false,
      ...(group ? { group } : { matched_via_entry_total: true }),
    })
  }

  const target = tx.transaktionsdatum
  out.sort((a, b) =>
    Math.abs(daysBetweenIso(a.entry_date, target)) - Math.abs(daysBetweenIso(b.entry_date, target))
    || a.journal_entry_id.localeCompare(b.journal_entry_id),
  )
  return out
}

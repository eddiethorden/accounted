import { describe, it, expect, vi } from 'vitest'
import { createQueuedMockSupabase } from '@/tests/helpers'
import {
  findMatchCandidates,
  findMatchSuggestionsBulk,
  SkattekontoMatchError,
} from '../lib/skattekonto-match'

const COMPANY = 'company-1'
const TX_ID = 'skv-tx-1'

function txRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TX_ID,
    company_id: COMPANY,
    transaktionsdatum: '2026-03-17',
    belopp_skatteverket: 5000,
    journal_entry_id: null,
    transaktionstext: 'Inbetalning bokförd',
    status: 'booked',
    ...overrides,
  }
}

function lineRow(opts: {
  entryId: string
  debit?: number
  credit?: number
  voucherNumber?: number | null
  entryDate?: string
  description?: string
  status?: 'draft' | 'posted' | 'reversed'
}) {
  return {
    debit_amount: opts.debit ?? 0,
    credit_amount: opts.credit ?? 0,
    journal_entries: {
      id: opts.entryId,
      voucher_number: opts.voucherNumber ?? 12,
      voucher_series: 'A',
      entry_date: opts.entryDate ?? '2026-03-16',
      description: opts.description ?? 'Test verifikat',
      status: opts.status ?? 'posted',
      company_id: COMPANY,
    },
  }
}

/**
 * Enqueue the two pages the two-step entry-lines fetch reads
 * (lib/bookkeeping/entry-lines.ts): the parent entries first, then the bare
 * lines keyed by journal_entry_id. Fixtures stay embed-shaped; the helper
 * reattaches the parent under `journal_entries`, which is exactly what the
 * old `journal_entries!inner(...)` embed produced.
 */
function enqueueLines(
  enqueue: (result: { data?: unknown; error?: unknown }) => void,
  rows: ReturnType<typeof lineRow>[],
) {
  const entries = [
    ...new Map(rows.map((r) => [r.journal_entries.id, r.journal_entries])).values(),
  ]
  enqueue({ data: entries })
  // No matching entry means the helper never queries the lines at all.
  if (entries.length === 0) return
  enqueue({
    data: rows.map((r, i) => ({
      id: `line-${String(i).padStart(4, '0')}`,
      journal_entry_id: r.journal_entries.id,
      debit_amount: r.debit_amount,
      credit_amount: r.credit_amount,
    })),
  })
}

// ──────────────────────────────────────────────────────────────────────
// findMatchCandidates
// ──────────────────────────────────────────────────────────────────────

describe('findMatchCandidates', () => {
  it('returns candidate verifikat that debits 1630 with matching amount (positive SKV → looks for debit on 1630)', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: txRow() })
    enqueueLines(enqueue, [lineRow({ entryId: 'je-1', debit: 5000, credit: 0 })])
    enqueue({ data: [] }) // no already-linked

    const result = await findMatchCandidates(supabase as never, COMPANY, TX_ID)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      journal_entry_id: 'je-1',
      matched_amount: 5000,
      matched_side: 'debit',
    })
  })

  it('uses credit 1630 lookup when SKV amount is negative (money leaving skattekontot)', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: txRow({ belopp_skatteverket: -8333, transaktionstext: 'Debiterad F-skatt' }) })
    enqueueLines(enqueue, [lineRow({ entryId: 'je-7', debit: 0, credit: 8333 })])
    enqueue({ data: [] })

    const result = await findMatchCandidates(supabase as never, COMPANY, TX_ID)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].matched_side).toBe('credit')
    expect(result.candidates[0].matched_amount).toBe(8333)
  })

  it('throws TRANSACTION_NOT_FOUND when the SKV row does not exist', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: null, error: { message: 'not found' } })

    await expect(findMatchCandidates(supabase as never, COMPANY, TX_ID)).rejects.toMatchObject({
      code: 'TRANSACTION_NOT_FOUND',
    })
  })

  it('throws ALREADY_BOOKED when the SKV row is already linked', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: txRow({ journal_entry_id: 'je-existing' }) })

    await expect(findMatchCandidates(supabase as never, COMPANY, TX_ID)).rejects.toMatchObject({
      code: 'ALREADY_BOOKED',
    })
  })

  it('filters out entries already linked to another SKV row', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: txRow() })
    enqueueLines(enqueue, [
      lineRow({ entryId: 'je-1', debit: 5000, credit: 0 }),
      lineRow({ entryId: 'je-2', debit: 5000, credit: 0 }),
    ])
    enqueue({ data: [{ journal_entry_id: 'je-1' }] }) // je-1 already linked

    const result = await findMatchCandidates(supabase as never, COMPANY, TX_ID)
    expect(result.candidates.map(c => c.journal_entry_id)).toEqual(['je-2'])
  })

  it('returns an empty list when no candidate lines match', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: txRow() })
    enqueue({ data: [] }) // no candidate lines

    const result = await findMatchCandidates(supabase as never, COMPANY, TX_ID)
    expect(result.candidates).toEqual([])
  })

  it('throws a SkattekontoMatchError (not a plain Error) so callers can switch on code', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: txRow({ journal_entry_id: 'je-existing' }) })

    await expect(findMatchCandidates(supabase as never, COMPANY, TX_ID)).rejects.toBeInstanceOf(
      SkattekontoMatchError,
    )
  })

  it('orders candidates by date proximity to the SKV row', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: txRow({ transaktionsdatum: '2026-03-17' }) })
    enqueueLines(enqueue, [
      lineRow({ entryId: 'je-far', debit: 5000, entryDate: '2026-03-08' }), // 9 days
      lineRow({ entryId: 'je-close', debit: 5000, entryDate: '2026-03-16' }), // 1 day
      lineRow({ entryId: 'je-mid', debit: 5000, entryDate: '2026-03-12' }), // 5 days
    ])
    enqueue({ data: [] })

    const result = await findMatchCandidates(supabase as never, COMPANY, TX_ID)
    expect(result.candidates.map(c => c.journal_entry_id)).toEqual([
      'je-close',
      'je-mid',
      'je-far',
    ])
  })
})

// ──────────────────────────────────────────────────────────────────────
// findMatchSuggestionsBulk
// ──────────────────────────────────────────────────────────────────────

describe('findMatchSuggestionsBulk', () => {
  it('returns a suggestion only when exactly one candidate matches per row', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueueLines(enqueue, [
      lineRow({ entryId: 'je-unique', debit: 5000, entryDate: '2026-03-16' }),
      // unrelated different-amount line that should not match
      lineRow({ entryId: 'je-other', debit: 9999, entryDate: '2026-03-16' }),
    ])
    enqueue({ data: [] }) // none linked

    const suggestions = await findMatchSuggestionsBulk(supabase as never, COMPANY, [
      {
        id: 'skv-1',
        transaktionsdatum: '2026-03-17',
        belopp_skatteverket: 5000,
        journal_entry_id: null,
      },
    ])

    expect(suggestions.size).toBe(1)
    expect(suggestions.get('skv-1')).toMatchObject({ journal_entry_id: 'je-unique' })
  })

  it('returns no suggestion when there are TWO candidates (ambiguous)', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueueLines(enqueue, [
      lineRow({ entryId: 'je-a', debit: 5000, entryDate: '2026-03-15' }),
      lineRow({ entryId: 'je-b', debit: 5000, entryDate: '2026-03-16' }),
    ])
    enqueue({ data: [] })

    const suggestions = await findMatchSuggestionsBulk(supabase as never, COMPANY, [
      {
        id: 'skv-1',
        transaktionsdatum: '2026-03-17',
        belopp_skatteverket: 5000,
        journal_entry_id: null,
      },
    ])
    expect(suggestions.size).toBe(0)
  })

  it('returns no suggestion when zero candidates match', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: [] })

    const suggestions = await findMatchSuggestionsBulk(supabase as never, COMPANY, [
      {
        id: 'skv-1',
        transaktionsdatum: '2026-03-17',
        belopp_skatteverket: 5000,
        journal_entry_id: null,
      },
    ])
    expect(suggestions.size).toBe(0)
  })

  it('skips rows that are already linked to a verifikat', async () => {
    // already-linked rows shouldn't even reach the candidate query: but
    // verify by passing no other unmatched rows; the queue stays empty.
    const { supabase } = createQueuedMockSupabase()

    const suggestions = await findMatchSuggestionsBulk(supabase as never, COMPANY, [
      {
        id: 'skv-1',
        transaktionsdatum: '2026-03-17',
        belopp_skatteverket: 5000,
        journal_entry_id: 'je-existing',
      },
    ])
    expect(suggestions.size).toBe(0)
  })

  it('skips candidates whose entry_date is outside the per-row ±14 day window', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueueLines(enqueue, [
      // 20 days before the SKV row: too far
      lineRow({ entryId: 'je-far', debit: 5000, entryDate: '2026-02-25' }),
    ])
    enqueue({ data: [] })

    const suggestions = await findMatchSuggestionsBulk(supabase as never, COMPANY, [
      {
        id: 'skv-1',
        transaktionsdatum: '2026-03-17',
        belopp_skatteverket: 5000,
        journal_entry_id: null,
      },
    ])
    expect(suggestions.size).toBe(0)
  })

  it('excludes entries that are already linked to a different SKV row', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueueLines(enqueue, [lineRow({ entryId: 'je-linked', debit: 5000, entryDate: '2026-03-16' })
    ])
    enqueue({ data: [{ journal_entry_id: 'je-linked' }] })

    const suggestions = await findMatchSuggestionsBulk(supabase as never, COMPANY, [
      {
        id: 'skv-1',
        transaktionsdatum: '2026-03-17',
        belopp_skatteverket: 5000,
        journal_entry_id: null,
      },
    ])
    expect(suggestions.size).toBe(0)
  })

  it('respects sign convention per row: negative SKV needs a credit on 1630', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueueLines(enqueue, [
      // Debit-side line: wrong side for a -8333 SKV row
      lineRow({ entryId: 'je-wrong-side', debit: 8333, entryDate: '2026-03-16' }),
    ])
    enqueue({ data: [] })

    const suggestions = await findMatchSuggestionsBulk(supabase as never, COMPANY, [
      {
        id: 'skv-1',
        transaktionsdatum: '2026-03-17',
        belopp_skatteverket: -8333,
        journal_entry_id: null,
      },
    ])
    expect(suggestions.size).toBe(0)
  })

  it('returns empty map immediately when no unmatched rows are provided', async () => {
    // No queue interaction expected: function should short-circuit.
    const { supabase } = createQueuedMockSupabase()
    const fromSpy = vi.spyOn(supabase, 'from')

    const suggestions = await findMatchSuggestionsBulk(supabase as never, COMPANY, [])

    expect(suggestions.size).toBe(0)
    expect(fromSpy).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────────────────────────────
// Combined verifikat and cancelled pairs (support case: a Spiris import
// booked avdragen skatt + arbetsgivaravgift as ONE 1630 line, and the
// proposal pointed at a verifikat its correction cancels line for line)
// ──────────────────────────────────────────────────────────────────────

describe('findMatchCandidates: combined verifikat', () => {
  const TAX = txRow({
    belopp_skatteverket: -16223,
    transaktionsdatum: '2026-06-12',
    transaktionstext: 'Avdragen skatt maj 2026',
  })

  it('offers a verifikat whose single 1630 line equals this row plus one open sibling, reaching back to the AGI period start', async () => {
    const { supabase, enqueue, findCalls } = createQueuedMockSupabase()
    enqueue({ data: TAX })
    enqueueLines(enqueue, []) // no exact twin
    enqueue({ data: [] }) // AGI declarations for maj 2026
    // group search: 1630 lines from 2026-05-01, the old system booked it in May
    enqueueLines(enqueue, [
      lineRow({ entryId: 'a121', credit: 39637, entryDate: '2026-05-12', voucherNumber: 121, description: 'AGI 2026-05-12' }),
    ])
    enqueue({ data: [] }) // nothing linked to a121
    enqueue({
      data: [
        { id: 'avg', transaktionsdatum: '2026-06-12', transaktionstext: 'Arbetsgivaravgift maj 2026', belopp_skatteverket: '-23414.00', journal_entry_id: null },
        { id: 'moms', transaktionsdatum: '2026-06-12', transaktionstext: 'Moms april 2026', belopp_skatteverket: '-5991.00', journal_entry_id: null },
      ],
    })
    enqueue({ data: [] }) // cancellation check

    const { candidates } = await findMatchCandidates(supabase as never, COMPANY, TX_ID)

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      journal_entry_id: 'a121',
      matched_amount: 39637,
      matched_side: 'credit',
      group: { mode: 'new', link_transaction_ids: [TX_ID, 'avg'] },
    })
    expect(candidates[0].group?.group_rows.map((r) => r.id)).toEqual(['avg'])
    expect(findCalls('journal_entries', 'gte')).toContainEqual(['entry_date', '2026-05-01'])
  })

  it('offers a partly linked verifikat that this row completes', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: txRow({ belopp_skatteverket: -8000, transaktionsdatum: '2026-03-12', transaktionstext: 'Debiterad preliminärskatt' }) })
    enqueueLines(enqueue, [])
    enqueueLines(enqueue, [
      lineRow({ entryId: 'pay', debit: 10000, entryDate: '2026-03-10' }),
      lineRow({ entryId: 'pay', credit: 8000, entryDate: '2026-03-10' }),
    ])
    enqueue({ data: [{ id: 'in', transaktionsdatum: '2026-03-11', transaktionstext: 'Inbetalning bokförd', belopp_skatteverket: 10000, journal_entry_id: 'pay' }] })
    enqueue({ data: [] }) // no open siblings
    enqueue({ data: [] }) // cancellation check

    const { candidates } = await findMatchCandidates(supabase as never, COMPANY, TX_ID)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].group).toMatchObject({ mode: 'join', link_transaction_ids: [TX_ID] })
  })

  it('offers nothing when two different sibling sets fit the same verifikat', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: TAX })
    enqueueLines(enqueue, [])
    enqueue({ data: [] })
    enqueueLines(enqueue, [lineRow({ entryId: 'a121', credit: 39637, entryDate: '2026-06-12' })])
    enqueue({ data: [] })
    enqueue({
      data: [
        { id: 's1', transaktionsdatum: '2026-06-12', transaktionstext: 'x', belopp_skatteverket: -23414, journal_entry_id: null },
        { id: 's2', transaktionsdatum: '2026-06-13', transaktionstext: 'y', belopp_skatteverket: -23414, journal_entry_id: null },
      ],
    })
    enqueue({ data: [] })

    const { candidates } = await findMatchCandidates(supabase as never, COMPANY, TX_ID)
    expect(candidates).toHaveLength(0)
  })

  it('drops an exact twin that a correction cancels and offers the combined verifikat instead', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: txRow({ belopp_skatteverket: -7704, transaktionsdatum: '2026-07-13', transaktionstext: 'Arbetsgivaravgift juni 2026' }) })
    enqueueLines(enqueue, [lineRow({ entryId: 'a177', credit: 7704, entryDate: '2026-07-13' })])
    enqueue({ data: [] }) // none linked
    enqueue({ data: [] }) // AGI declarations
    // cancellation check: storno fields tell it straight away
    enqueue({ data: [{ id: 'a177', entry_date: '2026-07-13', status: 'posted', reverses_id: null, reversed_by_id: 'a178' }] })
    // then the combined verifikat that really settles it
    enqueueLines(enqueue, [lineRow({ entryId: 'a157', credit: 12225, entryDate: '2026-07-13' })])
    enqueue({ data: [] }) // nothing linked to a157
    enqueue({
      data: [{ id: 'tax', transaktionsdatum: '2026-07-13', transaktionstext: 'Avdragen skatt juni 2026', belopp_skatteverket: -4521, journal_entry_id: null }],
    })
    enqueue({ data: [] }) // a157 is live

    const { candidates } = await findMatchCandidates(supabase as never, COMPANY, TX_ID)
    expect(candidates.map((c) => c.journal_entry_id)).toEqual(['a157'])
    expect(candidates[0].group?.link_transaction_ids).toEqual([TX_ID, 'tax'])
  })
})

describe('findMatchSuggestionsBulk: cancelled verifikat', () => {
  it('never proposes a verifikat that a storno cancelled', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueueLines(enqueue, [lineRow({ entryId: 'je-cancelled', debit: 5000, entryDate: '2026-03-16' })])
    enqueue({ data: [] }) // none linked
    enqueue({ data: [{ id: 'je-cancelled', entry_date: '2026-03-16', status: 'posted', reverses_id: 'orig', reversed_by_id: null }] })

    const suggestions = await findMatchSuggestionsBulk(supabase as never, COMPANY, [
      { id: 'skv-1', transaktionsdatum: '2026-03-17', belopp_skatteverket: 5000, journal_entry_id: null },
    ])
    expect(suggestions.size).toBe(0)
  })
})

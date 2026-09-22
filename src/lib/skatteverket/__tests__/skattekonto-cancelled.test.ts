import { describe, it, expect } from 'vitest'
import { createQueuedMockSupabase } from '@/tests/helpers'
import { findCancelledEntryIds, lineSignature } from '../skattekonto-cancelled'

const COMPANY = 'company-1'

type L = { account_number: string; debit_amount: number; credit_amount: number }
const head = (id: string, date = '2026-07-13', extra: Record<string, unknown> = {}) => ({
  id,
  entry_date: date,
  status: 'posted',
  reverses_id: null,
  reversed_by_id: null,
  ...extra,
})
const lines = (entryId: string, ls: L[]) =>
  ls.map((l, i) => ({ id: `${entryId}-l${i}`, journal_entry_id: entryId, ...l }))

// The imported pair from the support case: A177 books 7 704 on 1630/2940,
// A178 ("Korrigering av ver.nr. A177") books the exact mirror the same day.
const ORIGINAL: L[] = [
  { account_number: '1630', debit_amount: 0, credit_amount: 7704 },
  { account_number: '2940', debit_amount: 7704, credit_amount: 0 },
]
const MIRROR: L[] = [
  { account_number: '1630', debit_amount: 7704, credit_amount: 0 },
  { account_number: '2940', debit_amount: 0, credit_amount: 7704 },
]

/**
 * Queue order in findCancelledEntryIds: heads, own lines, neighbour entries,
 * neighbour 1630 lines, then the full lines of the neighbours that are not
 * candidates themselves.
 */
function enqueueScenario(
  enqueue: (r: { data?: unknown }) => void,
  opts: {
    heads: ReturnType<typeof head>[]
    own: ReturnType<typeof lines>
    neighbours: ReturnType<typeof head>[]
    neighbourLines: ReturnType<typeof lines>
  },
) {
  enqueue({ data: opts.heads })
  enqueue({ data: opts.own })
  enqueue({ data: opts.neighbours.map((n) => ({ id: n.id, entry_date: n.entry_date })) })
  enqueue({
    data: opts.neighbours.map((n, i) => ({ id: `n-${i}`, journal_entry_id: n.id })),
  })
  if (opts.neighbourLines.length > 0) enqueue({ data: opts.neighbourLines })
}

describe('lineSignature', () => {
  it('is order independent and swaps sides when mirrored', () => {
    expect(lineSignature(ORIGINAL)).toBe(lineSignature([...ORIGINAL].reverse()))
    expect(lineSignature(ORIGINAL, true)).toBe(lineSignature(MIRROR))
  })
})

describe('findCancelledEntryIds', () => {
  it('cancels our own storno pair from the status fields alone', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({
      data: [
        head('orig', '2026-07-13', { status: 'reversed', reversed_by_id: 'storno' }),
        head('storno', '2026-07-13', { reverses_id: 'orig' }),
      ],
    })
    const result = await findCancelledEntryIds(supabase as never, COMPANY, ['orig', 'storno'])
    expect([...result].sort()).toEqual(['orig', 'storno'])
  })

  it('cancels an imported entry whose exact mirror is posted the same week', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueueScenario(enqueue, {
      heads: [head('a177')],
      own: lines('a177', ORIGINAL),
      neighbours: [head('a177'), head('a178')],
      neighbourLines: lines('a178', MIRROR),
    })
    const result = await findCancelledEntryIds(supabase as never, COMPANY, ['a177'])
    expect(result.has('a177')).toBe(true)
  })

  it('leaves an uneven cluster alone: two identical payments and one reversal', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueueScenario(enqueue, {
      heads: [head('p1')],
      own: lines('p1', ORIGINAL),
      neighbours: [head('p1'), head('p2'), head('r1')],
      neighbourLines: [...lines('p2', ORIGINAL), ...lines('r1', MIRROR)],
    })
    const result = await findCancelledEntryIds(supabase as never, COMPANY, ['p1'])
    expect(result.size).toBe(0)
  })

  it('ignores a mirror outside the window and a same-amount entry on other accounts', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueueScenario(enqueue, {
      heads: [head('a157')],
      own: lines('a157', ORIGINAL),
      neighbours: [head('a157'), head('far', '2026-08-30'), head('other')],
      neighbourLines: [
        ...lines('far', MIRROR),
        ...lines('other', [
          { account_number: '1630', debit_amount: 7704, credit_amount: 0 },
          { account_number: '1930', debit_amount: 0, credit_amount: 7704 },
        ]),
      ],
    })
    const result = await findCancelledEntryIds(supabase as never, COMPANY, ['a157'])
    expect(result.size).toBe(0)
  })

  it('cancels nothing when the reads come back empty', async () => {
    const { supabase } = createQueuedMockSupabase()
    expect((await findCancelledEntryIds(supabase as never, COMPANY, ['x'])).size).toBe(0)
    expect((await findCancelledEntryIds(supabase as never, COMPANY, [])).size).toBe(0)
  })
})

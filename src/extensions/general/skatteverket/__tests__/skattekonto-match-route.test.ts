import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createQueuedMockSupabase } from '@/tests/helpers'
import { skatteverketExtension } from '../index'
import type { ExtensionContext } from '@/lib/extensions/types'

/**
 * POST / DELETE /skattekonto/transaktioner/:id/match
 *
 * POST links the row (and, for a combined verifikat, its open siblings) to an
 * existing verifikat through the core link. DELETE clears the pointer, never
 * the verifikat, and refuses a verifikat Bokför created from the row itself.
 */

const PATH = '/skattekonto/transaktioner/:id/match'
const ROW_ID = '11111111-1111-4111-8111-111111111111'
const SIBLING = '22222222-2222-4222-8222-222222222222'
const ENTRY = '33333333-3333-4333-8333-333333333333'

const { supabase, enqueue, reset, findCalls } = createQueuedMockSupabase()

function route(method: 'POST' | 'DELETE') {
  const r = skatteverketExtension.apiRoutes?.find((x) => x.method === method && x.path === PATH)
  if (!r) throw new Error(`${method} match route not registered`)
  return r
}

function ctx(): ExtensionContext {
  return {
    userId: 'user-1',
    companyId: 'company-1',
    extensionId: 'skatteverket',
    requestId: 'req_test',
    supabase,
    emit: vi.fn().mockResolvedValue(undefined),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() },
    settings: { get: vi.fn(), set: vi.fn(), clear: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function req(method: 'POST' | 'DELETE', body?: unknown, id: string | null = ROW_ID): Request {
  const url = new URL('http://localhost/api/extensions/ext/skatteverket/skattekonto/transaktioner/x/match')
  if (id) url.searchParams.set('_id', id)
  return new Request(url.toString(), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const openRow = (id: string, belopp: number) => ({
  id,
  belopp_skatteverket: belopp,
  journal_entry_id: null,
  is_ignored: false,
  status: 'booked',
})

describe('POST /skattekonto/transaktioner/:id/match', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it('returns 400 without an id, with bad JSON, without journal_entry_id, or with a malformed transaction_ids', async () => {
    expect((await route('POST').handler(req('POST', { journal_entry_id: ENTRY }, null), ctx())).status).toBe(400)
    expect((await route('POST').handler(req('POST', 'not json{'), ctx())).status).toBe(400)
    expect((await route('POST').handler(req('POST', {}), ctx())).status).toBe(400)
    expect(
      (await route('POST').handler(req('POST', { journal_entry_id: ENTRY, transaction_ids: 'x' }), ctx())).status,
    ).toBe(400)
  })

  it('returns 404 when the row is not in the company', async () => {
    enqueue({ data: [] })
    const res = await route('POST').handler(req('POST', { journal_entry_id: ENTRY }), ctx())
    expect(res.status).toBe(404)
  })

  it('links the row together with its siblings when the verifikat carries one combined 1630 line', async () => {
    enqueue({ data: [openRow(ROW_ID, -16223), openRow(SIBLING, -23414)] })
    enqueue({
      data: {
        id: ENTRY,
        status: 'posted',
        lines: [
          { account_number: '1630', debit_amount: 0, credit_amount: 39637 },
          { account_number: '2710', debit_amount: 16223, credit_amount: 0 },
          { account_number: '2731', debit_amount: 23414, credit_amount: 0 },
        ],
      },
    })
    enqueue({ data: [] }) // nothing linked to the verifikat yet
    enqueue({ data: [] }) // cancellation check
    enqueue({ data: [{ id: ROW_ID }, { id: SIBLING }] })

    const res = await route('POST').handler(
      req('POST', { journal_entry_id: ENTRY, transaction_ids: [ROW_ID, SIBLING] }),
      ctx(),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.skattekonto_transaction_ids).toEqual([ROW_ID, SIBLING])
    expect(findCalls('skattekonto_transactions', 'update')).toHaveLength(1)
  })

  it('returns 422 when the verifikat does not settle the row', async () => {
    enqueue({ data: [openRow(ROW_ID, -16223)] })
    enqueue({
      data: { id: ENTRY, status: 'posted', lines: [{ account_number: '1630', debit_amount: 0, credit_amount: 39637 }] },
    })
    enqueue({ data: [] })
    const res = await route('POST').handler(req('POST', { journal_entry_id: ENTRY }), ctx())
    expect(res.status).toBe(422)
  })
})

describe('DELETE /skattekonto/transaktioner/:id/match', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it('returns 400 without an id', async () => {
    expect((await route('DELETE').handler(req('DELETE', undefined, null), ctx())).status).toBe(400)
  })

  it('clears the pointer to an imported verifikat and leaves the verifikat alone', async () => {
    enqueue({ data: { id: ROW_ID, journal_entry_id: ENTRY } })
    enqueue({ data: { id: ENTRY, source_type: 'import', source_id: null } })
    enqueue({ data: { id: ROW_ID, journal_entry_id: ENTRY } })
    enqueue({ data: null })
    const res = await route('DELETE').handler(req('DELETE'), ctx())
    expect(res.status).toBe(200)
    expect(findCalls('skattekonto_transactions', 'update')[0][0]).toEqual({ journal_entry_id: null })
    expect(findCalls('journal_entries', 'update')).toHaveLength(0)
  })

  it('refuses a verifikat that Bokför created from this row (409)', async () => {
    enqueue({ data: { id: ROW_ID, journal_entry_id: ENTRY } })
    enqueue({ data: { id: ENTRY, source_type: 'system', source_id: ROW_ID } })
    const res = await route('DELETE').handler(req('DELETE'), ctx())
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('CREATED_FROM_ROW')
    expect(findCalls('skattekonto_transactions', 'update')).toHaveLength(0)
  })

  it('returns 409 for a row that is not linked', async () => {
    enqueue({ data: { id: ROW_ID, journal_entry_id: null } })
    enqueue({ data: { id: ROW_ID, journal_entry_id: null } })
    const res = await route('DELETE').handler(req('DELETE'), ctx())
    expect(res.status).toBe(409)
  })

  it('returns 404 for an unknown row', async () => {
    enqueue({ data: null })
    enqueue({ data: null })
    const res = await route('DELETE').handler(req('DELETE'), ctx())
    expect(res.status).toBe(404)
  })
})

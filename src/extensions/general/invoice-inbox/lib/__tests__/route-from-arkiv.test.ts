import { describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createQueuedMockSupabase } from '@/tests/helpers'
import { inboxSawABill, routeClassifiedDocument, routeStaleQueueItems } from '../route-from-arkiv'

const mock = createQueuedMockSupabase()
const { enqueue, reset, findCall, findCalls } = mock
const supabase = mock.supabase as unknown as SupabaseClient

const doc = { id: 'doc-1', user_id: 'user-1', journal_entry_id: null, extracted_data: { lineItems: [] } }
const item = (over: Record<string, unknown> = {}) => ({
  id: 'item-1',
  routed_to_arkiv_at: null,
  created_supplier_invoice_id: null,
  created_journal_entry_id: null,
  matched_transaction_id: null,
  ...over,
})
const classified = (docType: string, admission: 'admitted' | 'held' = 'admitted') =>
  routeClassifiedDocument(supabase, { documentId: 'doc-1', companyId: 'co-1', userId: 'user-1', docType, admission })

beforeEach(() => reset())

describe('routeClassifiedDocument', () => {
  it('never queues a document that arrived more than a day before it was classified: the backfill types old uploads', async () => {
    enqueue({ data: { ...doc, created_at: new Date(Date.now() - 8 * 86_400_000).toISOString() } })
    enqueue({ data: [] })
    expect(await classified('supplier_invoice')).toBe('left')
    expect(findCall('invoice_inbox_items', 'insert')).toBeUndefined()
  })

  it('queues one classified within the day it arrived', async () => {
    enqueue({ data: { ...doc, created_at: new Date(Date.now() - 3_600_000).toISOString() } })
    enqueue({ data: [] })
    enqueue({})
    expect(await classified('supplier_invoice')).toBe('queued')
  })

  it("queues a receipt that arrived any other way, with the Underlag reader's read when it ran", async () => {
    enqueue({ data: doc })
    enqueue({ data: [] })
    enqueue({})
    expect(await classified('receipt')).toBe('queued')
    expect(findCall('invoice_inbox_items', 'insert')?.[0]).toEqual({
      company_id: 'co-1',
      user_id: 'user-1',
      status: 'received',
      source: 'upload',
      document_id: 'doc-1',
      kind_hint: 'receipt',
      extracted_data: { lineItems: [] },
      extraction_skipped: false,
    })
  })

  it('leaves a receipt alone when it is already queued, booked, or attached to a voucher', async () => {
    enqueue({ data: doc })
    enqueue({ data: [item()] })
    expect(await classified('supplier_invoice')).toBe('already_queued')
    enqueue({ data: doc })
    enqueue({ data: [item({ matched_transaction_id: 'tx-1' })] })
    expect(await classified('supplier_invoice')).toBe('booked')
    enqueue({ data: { ...doc, journal_entry_id: 'je-1' } })
    enqueue({ data: [] })
    expect(await classified('receipt')).toBe('booked')
    expect(findCalls('invoice_inbox_items', 'insert')).toEqual([])
  })

  it('takes an agreement that came through the inbox out of the queue, and puts it back when a person retypes it', async () => {
    enqueue({ data: doc })
    enqueue({ data: [item(), item({ id: 'item-2', matched_transaction_id: 'tx-9' })] })
    enqueue({})
    expect(await classified('agreement.loan')).toBe('routed_to_arkiv')
    expect(findCall('invoice_inbox_items', 'update')?.[0]).toEqual({ routed_to_arkiv_at: expect.any(String), routed_doc_type: 'agreement.loan' })
    expect(findCall('invoice_inbox_items', 'in')).toEqual(['id', ['item-1']])

    reset()
    enqueue({ data: doc })
    enqueue({ data: [item({ routed_to_arkiv_at: '2026-09-16T05:00:00Z' })] })
    enqueue({})
    expect(await classified('receipt')).toBe('requeued')
    expect(findCall('invoice_inbox_items', 'update')?.[0]).toEqual({ routed_to_arkiv_at: null, routed_doc_type: null })
  })

  it("does nothing for a held document, an unknown one, or a document that is not the company's", async () => {
    enqueue({ data: doc })
    enqueue({ data: [] })
    expect(await classified('receipt', 'held')).toBe('left')
    enqueue({ data: doc })
    enqueue({ data: [item({ routed_to_arkiv_at: '2026-09-16T05:00:00Z' })] })
    expect(await classified('other')).toBe('left')
    enqueue({ data: null })
    expect(await classified('receipt')).toBe('not_found')
  })
})

describe('inboxSawABill: where the readers disagree, the item stays in Underlag', () => {
  it('keeps what the inbox read as a receipt or supplier invoice, whatever Arkiv typed it', () => {
    expect(inboxSawABill({ documentKind: 'supplier_invoice' }, 'customer_invoice')).toBe(true)
    expect(inboxSawABill({ documentKind: 'receipt' }, 'other')).toBe(true)
  })

  it('keeps an amount on a government letter (a congestion-tax bill) or on a document Arkiv could only call other (a credit note)', () => {
    expect(inboxSawABill({ documentKind: 'government_letter', totals: { total: 86 } }, 'decision.skatteverket')).toBe(true)
    expect(inboxSawABill({ documentKind: 'other', totals: { total: 16.4 } }, 'other')).toBe(true)
  })

  it('lets go of a letter with nothing to pay, an agreement with an amount in it, and anything the inbox never read', () => {
    expect(inboxSawABill({ documentKind: 'government_letter', totals: { total: null } }, 'registration.bolagsverket')).toBe(false)
    expect(inboxSawABill({ documentKind: 'other', totals: { total: 5000 } }, 'minutes.board')).toBe(false)
    expect(inboxSawABill(null, 'other')).toBe(false)
  })
})

describe('routing a bill the inbox saw', () => {
  it('leaves it in the queue when Arkiv types it as something else', async () => {
    enqueue({ data: doc })
    enqueue({ data: [item({ extracted_data: { documentKind: 'government_letter', totals: { total: 86 } } })] })
    expect(await classified('decision.skatteverket')).toBe('left')
    expect(findCall('invoice_inbox_items', 'update')).toBeUndefined()
  })

  it('is left in the queue by the nightly catch-up too', async () => {
    enqueue({
      data: [
        { id: 'bill', document_id: 'd1', extracted_data: { documentKind: 'receipt' }, document_attachments: { doc_type: 'other', admission_state: 'admitted' } },
        { id: 'deal', document_id: 'd2', extracted_data: { documentKind: 'other' }, document_attachments: { doc_type: 'agreement.loan', admission_state: 'admitted' } },
      ],
    })
    enqueue({})
    expect(await routeStaleQueueItems(supabase)).toBe(1)
    expect(findCall('invoice_inbox_items', 'in')).toEqual(['id', ['deal']])
  })
})


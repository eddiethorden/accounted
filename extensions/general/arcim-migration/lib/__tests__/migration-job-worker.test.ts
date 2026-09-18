import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProviderMigrationJob } from '@/lib/providers/migration-contract'
import { sealMigrationPayload } from '@/lib/providers/migration-payload'
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), page: vi.fn(), hydrate: vi.fn(), link: vi.fn(), reconcile: vi.fn() }))
vi.mock('@/lib/auth/api-keys', () => ({ createServiceClientNoCookies: vi.fn() }))
vi.mock('@/lib/providers/resolve-consent', () => ({ resolveConsent: mocks.resolve }))
vi.mock('@/lib/providers/provider-data-fetcher', () => ({ fetchMigrationPage: mocks.page, hydrateSalesInvoices: mocks.hydrate, hydrateSupplierInvoices: mocks.hydrate }))
vi.mock('@/lib/invoices/link-migrated-registration-vouchers', () => ({ linkMigratedRegistrationVouchers: mocks.link }))
vi.mock('@/lib/invoices/bulk-reconcile-supplier-vouchers', () => ({ reconcileSupplierInvoiceVouchers: mocks.reconcile }))
vi.mock('../entity-mapper', () => ({
  mapCustomer: (dto: { party: { name: string } }) => ({ name: dto.party.name }),
  mapSupplier: (dto: { party: { name: string } }) => ({ name: dto.party.name }),
  buildFxRateIndex: vi.fn().mockResolvedValue(new Map()),
  mapSalesInvoice: () => ({ invoice: { subtotal: 100, vat_amount: 25, total_sek: 125 }, items: [{ line_total: 100, vat_amount: 25 }] }),
  mapSupplierInvoice: () => ({ invoice: { subtotal: 100, vat_amount: 25, total_sek: 125 }, items: [{ line_total: 100, vat_amount: 25 }] }),
}))
import { runProviderMigrationWorker, withinMigrationDeadline } from '../migration-job-worker'

function database(overrides: Partial<ProviderMigrationJob> = {}) {
  const job = { id: 'job', company_id: 'company', user_id: 'user', consent_id: 'consent', provider: 'visma',
    resources: ['customers'], resource_index: 1, next_page: 1, phase: 'discover', state: 'queued',
    account_key: '5560000000', attempt: 0, failures: 0, fiscal_year_scope: null, ...overrides } as ProviderMigrationJob
  type Row = { id: string; resource: string; source_id: string; payload: string; state: string; target_id?: string; receipt?: unknown }
  const rows: Row[] = []
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'claim_provider_migration_job') {
      if (job.state === 'completed' || job.state === 'needs_attention') return { data: null }
      Object.assign(job, { worker_id: args.p_worker_id, state: 'running', attempt: job.attempt + 1 })
      return { data: { ...job } }
    }
    if (name === 'save_provider_migration_page') {
      for (const r of args.p_records as Row[]) {
        if (!rows.some(row => row.source_id === r.source_id)) rows.push({ ...r, id: r.source_id, resource: args.p_resource as string, state: 'pending' })
      }
      if (args.p_next_page === null) job.phase = 'import'
      else if (args.p_next_page !== 0) job.next_page = args.p_next_page as number
    }
    if (name === 'commit_provider_migration_records') {
      for (const r of args.p_records as { id: string; error?: string }[]) rows.find(row => row.id === r.id)!.state = r.error ? 'needs_attention' : 'done'
    }
    if (name === 'advance_provider_migration_job') {
      job.phase = ({ import: 'link', link: 'reconcile', reconcile: 'settle', settle: 'completed' } as const)[job.phase as 'import' | 'link' | 'reconcile' | 'settle']
      if (job.phase === 'completed') job.state = rows.some(r => r.state === 'needs_attention') ? 'needs_attention' : 'completed'
    }
    if (name === 'release_provider_migration_job') {
      job.state = !args.p_error_code ? 'queued' : args.p_retry_seconds === -1 ? 'needs_attention' : 'retry_wait'
      job.error_code = args.p_error_code as string | null
    }
    return { data: null, error: null }
  })
  const supabase = { rpc, from: (table: string) => {
    let state: string | undefined; let limit = Infinity
    const chain = { select: () => chain, eq: (key: string, value: string) => { if (key === 'state') state = value; return chain },
      order: () => chain, limit: (value: number) => { limit = value; return chain }, single: () => chain,
      then: (resolve: (data: unknown) => void) => resolve({ data: table === 'migration_jobs' ? { ...job } : rows.filter(r => r.state === state).slice(0, limit), error: null }) }
    return chain
  } } as unknown as SupabaseClient
  return { supabase, rpc, job, rows }
}
const customer = (id: number) => ({ id: `customer-${id}`, active: true, party: { name: `Customer ${id}` } })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolve.mockResolvedValue({ accessToken: 'token', consent: { provider: 'visma', org_number: '556000-0000' } })
})
afterEach(() => vi.useRealTimers())
describe('bounded durable worker', () => {
  it('resumes the saved page after a rate limit and commits a large register in bounded groups', async () => {
    const db = database()
    mocks.page.mockResolvedValueOnce({ items: Array.from({ length: 351 }, (_, i) => customer(i)), nextPage: 2, total: 352 })
      .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { statusCode: 429 }))
      .mockResolvedValueOnce({ items: [customer(351)], nextPage: null, total: 352 })
    await runProviderMigrationWorker({ supabase: db.supabase, jobId: db.job.id })
    expect(db.job).toMatchObject({ state: 'retry_wait', next_page: 2, error_code: 'PROVIDER_RATE_LIMITED' })
    expect(db.rows).toHaveLength(351)
    await runProviderMigrationWorker({ supabase: db.supabase, jobId: db.job.id })
    expect(mocks.page.mock.calls.map(call => call[4])).toEqual([1, 2, 2])
    expect(db.job.state).toBe('completed')
    expect(db.rows.filter(r => r.state === 'done')).toHaveLength(352)
    const commits = db.rpc.mock.calls.filter(([name]) => name === 'commit_provider_migration_records')
    expect(commits.length).toBe(36)
    expect(commits.every(([, args]) => (args.p_records as unknown[]).length <= 10)).toBe(true)
    const segments = db.rpc.mock.calls.filter(([name]) => name === 'save_provider_migration_page')
    expect(segments.map(([, args]) => args.p_next_page)).toEqual([0, 2, null])
  })
  it('keeps prepared healthy records when the next invoice loses authorization', async () => {
    const db = database({ phase: 'import', resources: ['salesInvoices'] })
    const dto = (id: string) => ({ id, issueDate: '2026-01-01', currencyCode: 'SEK', _raw: { CustomerId: 'customer' },
      customer: { name: 'Customer', identifications: [] }, lines: [{}] })
    for (const id of ['a', 'b']) db.rows.push({ id, source_id: id, resource: 'salesInvoices', state: 'pending', ...sealMigrationPayload(dto(id)) })
    mocks.hydrate.mockResolvedValueOnce({ invoices: [dto('a')], unhydratedIds: new Set(), hydration: {} })
      .mockResolvedValueOnce({ invoices: [dto('b')], unhydratedIds: new Set(['b']), hydration: { abortedBy: 'auth' } })
    await runProviderMigrationWorker({ supabase: db.supabase, jobId: db.job.id })
    expect(db.rows.map(r => r.state)).toEqual(['done', 'pending'])
    expect(db.job).toMatchObject({ state: 'needs_attention', error_code: 'PROVIDER_AUTH_EXPIRED' })
    expect(mocks.hydrate.mock.calls.every(call => call[3].length === 1)).toBe(true)
  })
  it('isolates an exhausted detail failure while continuing healthy invoices', async () => {
    const db = database({ phase: 'import', resources: ['salesInvoices'] })
    const dto = (id: string) => ({ id, issueDate: '2026-01-01', currencyCode: 'SEK', _raw: { CustomerId: 'customer' },
      customer: { name: 'Customer', identifications: [] }, lines: [{}] })
    for (const id of ['a', 'b']) db.rows.push({ id, source_id: id, resource: 'salesInvoices', state: 'pending', ...sealMigrationPayload(dto(id)) })
    mocks.hydrate.mockResolvedValueOnce({ invoices: [dto('a')], unhydratedIds: new Set(['a']), hydration: { abortedBy: 'budget' } })
      .mockResolvedValueOnce({ invoices: [dto('b')], unhydratedIds: new Set(), hydration: {} })
    await runProviderMigrationWorker({ supabase: db.supabase, jobId: db.job.id })
    expect(db.rows.map(r => r.state)).toEqual(['needs_attention', 'done'])
    expect(db.job.state).toBe('needs_attention')
  })
  it('yields a hung provider request at the worker deadline without advancing its cursor', async () => {
    vi.useFakeTimers()
    const db = database()
    mocks.page.mockReturnValue(new Promise(() => {}))
    const run = runProviderMigrationWorker({ supabase: db.supabase, jobId: db.job.id, budgetMs: 20_000 })
    await vi.advanceTimersByTimeAsync(16_000)
    await run
    expect(db.job).toMatchObject({ state: 'queued', next_page: 1 })
    expect(db.rows).toHaveLength(0)
  })
  it('bounds reads as well as provider operations', async () => {
    vi.useFakeTimers()
    const promise = withinMigrationDeadline(new Promise(() => {}), Date.now() + 25)
    const assertion = expect(promise).rejects.toThrow('MIGRATION_DEADLINE')
    await vi.advanceTimersByTimeAsync(25)
    await assertion
  })
})

it('pauses before any source fetch if reconnecting changed the provider account', async () => {
  const db = database()
  mocks.resolve.mockResolvedValue({ accessToken: 'token', consent: { provider: 'visma', org_number: '5569999999' } })
  await runProviderMigrationWorker({ supabase: db.supabase, jobId: db.job.id })
  expect(db.job).toMatchObject({ state: 'needs_attention', error_code: 'MIGRATION_SOURCE_IDENTITY_CHANGED' })
  expect(mocks.page).not.toHaveBeenCalled()
})

it('recognizes the consent resolver’s structured authorization errors', async () => {
  const db = database()
  mocks.resolve.mockRejectedValue({ status: 401, message: 'No tokens found' })
  await runProviderMigrationWorker({ supabase: db.supabase, jobId: db.job.id })
  expect(db.job).toMatchObject({ state: 'needs_attention', error_code: 'PROVIDER_AUTH_EXPIRED' })
  expect(mocks.page).not.toHaveBeenCalled()
})

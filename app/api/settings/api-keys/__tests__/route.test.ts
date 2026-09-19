import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockRequest, parseJsonResponse } from '@/tests/helpers'

// ── Mocks ──────────────────────────────────────────────────────────
// withRouteContext resolves auth via requireAuth (createClient under the hood),
// the active company via getActiveCompanyId, and the write gate via
// requireWritePermission. Mock all three so we can drive each branch.

const mockSupabase = {
  auth: { getUser: vi.fn() },
  from: vi.fn(),
}

// api_key_companies is a service-role table: the routes read and write it
// through createServiceClient, never through the session client.
const serviceSupabase = {
  from: vi.fn(),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => Promise.resolve(mockSupabase),
  createServiceClient: () => serviceSupabase,
}))

const getActiveCompanyIdMock = vi.fn()
vi.mock('@/lib/company/context', () => ({
  getActiveCompanyId: (...args: unknown[]) => getActiveCompanyIdMock(...args),
}))

const requireWritePermissionMock = vi.fn()
vi.mock('@/lib/auth/require-write', () => ({
  requireWritePermission: (...args: unknown[]) => requireWritePermissionMock(...args),
}))

const listUserCompaniesForPickerMock = vi.fn()
vi.mock('@/lib/company/company-picker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/company/company-picker')>()
  return {
    ...actual,
    listUserCompaniesForPicker: (...args: unknown[]) => listUserCompaniesForPickerMock(...args),
  }
})

import { GET, POST } from '../route'

const mockUser = { id: 'user-1', email: 'test@test.se' }
// Static route: withRouteContext still types the second handler argument.
const noParams = { params: Promise.resolve({}) }

const ACTIVE = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const THIRD = '33333333-3333-4333-8333-333333333333'
const FOREIGN = '99999999-9999-4999-8999-999999999999'
const memberships = [
  { company_id: ACTIVE, name: 'Aktiva AB', role: 'owner' },
  { company_id: OTHER, name: 'Andra AB', role: 'owner' },
  { company_id: THIRD, name: 'Tredje AB', role: 'member' },
]

// Records the payload passed to .insert(), and lets us program the count
// returned by the quota pre-check and the row returned by the insert.
function setupFrom(opts: {
  count?: number | null
  insertResult?: { data?: unknown; error?: unknown }
  listResult?: { data?: unknown; error?: unknown }
}) {
  const insertSpy = vi.fn()

  mockSupabase.from.mockImplementation(() => {
    // The quota pre-check: .select(..., { head: true }).eq().is() → resolves
    // to { count }. The insert: .insert().select().single() → resolves to the
    // row. We expose both via a single chainable proxy whose terminal value
    // depends on whether insert() was called.
    let isInsert = false
    const result = () =>
      isInsert
        ? Promise.resolve({
            data: opts.insertResult?.data ?? null,
            error: opts.insertResult?.error ?? null,
          })
        : Promise.resolve({
            count: opts.count ?? 0,
            data: opts.listResult?.data ?? null,
            error: opts.listResult?.error ?? null,
          })

    const chain: Record<string, unknown> = {}
    const handler: ProxyHandler<object> = {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => resolve(result() as unknown)
        }
        if (prop === 'insert') {
          return (payload: unknown) => {
            isInsert = true
            insertSpy(payload)
            return new Proxy(chain, handler)
          }
        }
        if (prop === 'single' || prop === 'maybeSingle') {
          return () => result()
        }
        return () => new Proxy(chain, handler)
      },
    }
    return new Proxy(chain, handler)
  })

  return { insertSpy }
}

/**
 * Service-role client stub: records every insert/update/select per table and
 * resolves each chain with the programmed result for that table.
 */
function setupServiceFrom(results: Record<string, { data?: unknown; error?: unknown }> = {}) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = []
  serviceSupabase.from.mockImplementation((table: string) => {
    const result = { data: results[table]?.data ?? null, error: results[table]?.error ?? null }
    const chain: Record<string, unknown> = {}
    const handler: ProxyHandler<object> = {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => resolve(result)
        }
        return (...args: unknown[]) => {
          calls.push({ table, method: String(prop), args })
          return new Proxy(chain, handler)
        }
      },
    }
    return new Proxy(chain, handler)
  })
  const find = (table: string, method: string) =>
    calls.find((c) => c.table === table && c.method === method)?.args
  return { calls, find }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser } })
  getActiveCompanyIdMock.mockResolvedValue('company-1')
  requireWritePermissionMock.mockResolvedValue({ ok: true })
  listUserCompaniesForPickerMock.mockResolvedValue([{ company_id: 'company-1', name: 'Test AB', role: 'owner' }])
  setupServiceFrom()
})

describe('POST /api/settings/api-keys', () => {
  it('returns 401 when not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })
    const res = await POST(
      createMockRequest('/api/settings/api-keys', {
        method: 'POST',
        body: { name: 'k', scopes: ['reports:read'] },
      }),
      noParams,
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 for an invalid scope', async () => {
    setupFrom({ count: 0 })
    const res = await POST(
      createMockRequest('/api/settings/api-keys', {
        method: 'POST',
        body: { name: 'k', scopes: ['totally:bogus'] },
      }),
      noParams,
    )
    const { status, body } = await parseJsonResponse<{ error: { code: string } }>(res)
    expect(status).toBe(400)
    expect(body.error.code).toBe('API_KEY_SCOPE_INVALID')
  })

  it('returns 400 for the reserved OAuth marker name (would fake a Claude connection)', async () => {
    const { insertSpy } = setupFrom({ count: 0 })
    const res = await POST(
      createMockRequest('/api/settings/api-keys', {
        method: 'POST',
        body: { name: ' MCP-klient (OAuth) ', scopes: ['reports:read'] },
      }),
      noParams,
    )
    const { status, body } = await parseJsonResponse<{
      error: { code: string; details: { field: string; reason: string } }
    }>(res)
    expect(status).toBe(400)
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.details).toMatchObject({ field: 'name', reason: 'reserved' })
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('returns 409 API_KEY_SOD_CONFLICT for stage+approve without acknowledgement', async () => {
    setupFrom({ count: 0 })
    const res = await POST(
      createMockRequest('/api/settings/api-keys', {
        method: 'POST',
        body: {
          name: 'k',
          scopes: ['invoices:write', 'pending_operations:approve'],
        },
      }),
      noParams,
    )
    const { status, body } = await parseJsonResponse<{
      error: { code: string; details: { conflicting_scope: string; approve_scope: string } }
    }>(res)
    expect(status).toBe(409)
    expect(body.error.code).toBe('API_KEY_SOD_CONFLICT')
    expect(body.error.details.conflicting_scope).toBe('invoices:write')
    expect(body.error.details.approve_scope).toBe('pending_operations:approve')
  })

  it('records sod_acknowledged_at/by in the insert when acknowledge_sod is true', async () => {
    const { insertSpy } = setupFrom({
      count: 0,
      insertResult: {
        data: {
          id: 'ak-1',
          key_prefix: 'gnubok_sk_abcd',
          name: 'k',
          scopes: ['invoices:write', 'pending_operations:approve'],
          created_at: '2026-06-05T10:00:00Z',
        },
      },
    })
    const res = await POST(
      createMockRequest('/api/settings/api-keys', {
        method: 'POST',
        body: {
          name: 'k',
          scopes: ['invoices:write', 'pending_operations:approve'],
          acknowledge_sod: true,
        },
      }),
      noParams,
    )
    const { status, body } = await parseJsonResponse<{ data: { key: string } }>(res)
    expect(status).toBe(200)
    expect(body.data.key).toMatch(/^gnubok_sk_/)

    expect(insertSpy).toHaveBeenCalledTimes(1)
    const payload = insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(payload.sod_acknowledged_by).toBe('user-1')
    expect(typeof payload.sod_acknowledged_at).toBe('string')
    // ISO timestamp
    expect(payload.sod_acknowledged_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('creates a clean key without approve scope and does not set SoD fields', async () => {
    const { insertSpy } = setupFrom({
      count: 0,
      insertResult: {
        data: {
          id: 'ak-2',
          key_prefix: 'gnubok_sk_efgh',
          name: 'reader',
          scopes: ['reports:read'],
          created_at: '2026-06-05T10:00:00Z',
        },
      },
    })
    const res = await POST(
      createMockRequest('/api/settings/api-keys', {
        method: 'POST',
        body: { name: 'reader', scopes: ['reports:read'] },
      }),
      noParams,
    )
    const { status, body } = await parseJsonResponse<{ data: { company_ids: string[] | null } }>(res)
    expect(status).toBe(200)
    // No allowlist requested: unrestricted, and no service-role write.
    expect(body.data.company_ids).toBeNull()
    expect(serviceSupabase.from).not.toHaveBeenCalled()

    const payload = insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('sod_acknowledged_at')
    expect(payload).not.toHaveProperty('sod_acknowledged_by')
    expect(payload.scopes).toEqual(['reports:read'])
    // Default mode is live, bound to the active company.
    expect(payload.mode).toBe('live')
    expect(payload.company_id).toBe('company-1')
  })

  it('creates a test key bound to the active company with mode=test', async () => {
    const { insertSpy } = setupFrom({
      count: 0,
      insertResult: {
        data: {
          id: 'ak-3',
          key_prefix: 'gnubok_sk_test_abc',
          name: 'pilot',
          scopes: ['reports:read'],
          mode: 'test',
          created_at: '2026-06-05T10:00:00Z',
        },
      },
    })
    const res = await POST(
      createMockRequest('/api/settings/api-keys', {
        method: 'POST',
        body: { name: 'pilot', scopes: ['reports:read'], mode: 'test' },
      }),
      noParams,
    )
    const { status, body } = await parseJsonResponse<{ data: { key: string } }>(res)
    expect(status).toBe(200)
    // Real generateApiKey('test') runs: the returned secret carries the infix.
    expect(body.data.key).toMatch(/^gnubok_sk_test_/)

    const payload = insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(payload.mode).toBe('test')
    // Test keys are simulation-only: they bind to the active company (the v1
    // wrapper forces dry-run so they never persist).
    expect(payload.company_id).toBe('company-1')
  })

  describe('company_ids (per-key company allowlist)', () => {
    beforeEach(() => {
      getActiveCompanyIdMock.mockResolvedValue(ACTIVE)
      listUserCompaniesForPickerMock.mockResolvedValue(memberships)
    })

    it('returns 400 VALIDATION_ERROR for a non-uuid company id and inserts nothing', async () => {
      const { insertSpy } = setupFrom({ count: 0 })
      const res = await POST(
        createMockRequest('/api/settings/api-keys', {
          method: 'POST',
          body: { name: 'k', scopes: ['reports:read'], company_ids: ['not-a-uuid'] },
        }),
        noParams,
      )
      const { status, body } = await parseJsonResponse<{ error: { code: string; details: { field: string } } }>(res)
      expect(status).toBe(400)
      expect(body.error.code).toBe('VALIDATION_ERROR')
      expect(body.error.details.field).toBe('company_ids')
      expect(insertSpy).not.toHaveBeenCalled()
    })

    it('returns 403 FORBIDDEN when an id is not one of the caller\'s memberships', async () => {
      const { insertSpy } = setupFrom({ count: 0 })
      const res = await POST(
        createMockRequest('/api/settings/api-keys', {
          method: 'POST',
          body: { name: 'k', scopes: ['reports:read'], company_ids: [ACTIVE, FOREIGN] },
        }),
        noParams,
      )
      const { status, body } = await parseJsonResponse<{
        error: { code: string; details: { company_ids: string[] } }
      }>(res)
      expect(status).toBe(403)
      expect(body.error.code).toBe('FORBIDDEN')
      expect(body.error.details.company_ids).toEqual([FOREIGN])
      expect(insertSpy).not.toHaveBeenCalled()
      expect(serviceSupabase.from).not.toHaveBeenCalled()
    })

    it('writes allowlist rows for a strict subset and keeps the active company as default', async () => {
      const { insertSpy } = setupFrom({
        count: 0,
        insertResult: {
          data: { id: 'ak-4', key_prefix: 'gnubok_sk_ijkl', name: 'k', scopes: ['reports:read'], created_at: '2026-06-05T10:00:00Z' },
        },
      })
      const service = setupServiceFrom()
      const res = await POST(
        createMockRequest('/api/settings/api-keys', {
          method: 'POST',
          body: { name: 'k', scopes: ['reports:read'], company_ids: [THIRD, ACTIVE] },
        }),
        noParams,
      )
      const { status, body } = await parseJsonResponse<{ data: { company_ids: string[] | null } }>(res)
      expect(status).toBe(200)
      // Picker order, not submission order.
      expect(body.data.company_ids).toEqual([ACTIVE, THIRD])

      const keyPayload = insertSpy.mock.calls[0][0] as Record<string, unknown>
      expect(keyPayload.company_id).toBe(ACTIVE)
      expect(service.find('api_key_companies', 'insert')?.[0]).toEqual([
        { api_key_id: 'ak-4', company_id: ACTIVE },
        { api_key_id: 'ak-4', company_id: THIRD },
      ])
    })

    it('binds the key to the first selected company when the active one is left out', async () => {
      const { insertSpy } = setupFrom({
        count: 0,
        insertResult: {
          data: { id: 'ak-5', key_prefix: 'gnubok_sk_mnop', name: 'k', scopes: ['reports:read'], created_at: '2026-06-05T10:00:00Z' },
        },
      })
      const service = setupServiceFrom()
      const res = await POST(
        createMockRequest('/api/settings/api-keys', {
          method: 'POST',
          body: { name: 'k', scopes: ['reports:read'], company_ids: [THIRD, OTHER] },
        }),
        noParams,
      )
      expect(res.status).toBe(200)
      const keyPayload = insertSpy.mock.calls[0][0] as Record<string, unknown>
      expect(keyPayload.company_id).toBe(OTHER)
      expect(service.find('api_key_companies', 'insert')?.[0]).toEqual([
        { api_key_id: 'ak-5', company_id: OTHER },
        { api_key_id: 'ak-5', company_id: THIRD },
      ])
    })

    it('writes nothing when every membership is selected (unrestricted key)', async () => {
      const { insertSpy } = setupFrom({
        count: 0,
        insertResult: {
          data: { id: 'ak-6', key_prefix: 'gnubok_sk_qrst', name: 'k', scopes: ['reports:read'], created_at: '2026-06-05T10:00:00Z' },
        },
      })
      const res = await POST(
        createMockRequest('/api/settings/api-keys', {
          method: 'POST',
          body: { name: 'k', scopes: ['reports:read'], company_ids: [THIRD, OTHER, ACTIVE] },
        }),
        noParams,
      )
      const { status, body } = await parseJsonResponse<{ data: { company_ids: string[] | null } }>(res)
      expect(status).toBe(200)
      expect(body.data.company_ids).toBeNull()
      expect((insertSpy.mock.calls[0][0] as Record<string, unknown>).company_id).toBe(ACTIVE)
      expect(serviceSupabase.from).not.toHaveBeenCalled()
    })

    it('revokes the key and answers 500 when the allowlist insert fails', async () => {
      setupFrom({
        count: 0,
        insertResult: {
          data: { id: 'ak-7', key_prefix: 'gnubok_sk_uvwx', name: 'k', scopes: ['reports:read'], created_at: '2026-06-05T10:00:00Z' },
        },
      })
      const service = setupServiceFrom({ api_key_companies: { error: { message: 'fk violation', code: '23503' } } })
      const res = await POST(
        createMockRequest('/api/settings/api-keys', {
          method: 'POST',
          body: { name: 'k', scopes: ['reports:read'], company_ids: [ACTIVE] },
        }),
        noParams,
      )
      const { status, body } = await parseJsonResponse<{ error: { code: string }; data?: unknown }>(res)
      expect(status).toBe(500)
      expect(body.error.code).toBe('API_KEY_CREATE_FAILED')
      expect(body.data).toBeUndefined()
      const revoke = service.find('api_keys', 'update')?.[0] as Record<string, unknown>
      expect(typeof revoke.revoked_at).toBe('string')
      expect(service.find('api_keys', 'eq')).toEqual(['id', 'ak-7'])
    })
  })
})

describe('GET /api/settings/api-keys', () => {
  it('returns 401 when not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })
    const res = await GET(createMockRequest('/api/settings/api-keys'), noParams)
    expect(res.status).toBe(401)
  })

  it('adds company_ids per key (null = unrestricted) and the picker companies in meta', async () => {
    getActiveCompanyIdMock.mockResolvedValue(ACTIVE)
    listUserCompaniesForPickerMock.mockResolvedValue(memberships)
    setupFrom({
      listResult: {
        data: [
          { id: 'ak-1', key_prefix: 'gnubok_sk_a', name: 'restricted', scopes: ['reports:read'], revoked_at: null, created_at: '2026-06-05T10:00:00Z' },
          { id: 'ak-2', key_prefix: 'gnubok_sk_b', name: 'open', scopes: ['reports:read'], revoked_at: null, created_at: '2026-06-04T10:00:00Z' },
        ],
      },
    })
    const service = setupServiceFrom({
      api_key_companies: {
        data: [
          { api_key_id: 'ak-1', company_id: ACTIVE },
          { api_key_id: 'ak-1', company_id: THIRD },
        ],
      },
    })

    const res = await GET(createMockRequest('/api/settings/api-keys'), noParams)
    const { status, body } = await parseJsonResponse<{
      data: Array<{ id: string; company_ids: string[] | null }>
      meta: { companies: Array<{ company_id: string; name: string; is_active: boolean }> }
    }>(res)
    expect(status).toBe(200)
    expect(body.data).toEqual([
      expect.objectContaining({ id: 'ak-1', company_ids: [ACTIVE, THIRD] }),
      expect.objectContaining({ id: 'ak-2', company_ids: null }),
    ])
    expect(body.meta.companies).toEqual([
      { company_id: ACTIVE, name: 'Aktiva AB', is_active: true },
      { company_id: OTHER, name: 'Andra AB', is_active: false },
      { company_id: THIRD, name: 'Tredje AB', is_active: false },
    ])
    // One query for all listed keys, grouped in code.
    expect(service.find('api_key_companies', 'in')).toEqual(['api_key_id', ['ak-1', 'ak-2']])
    expect(listUserCompaniesForPickerMock).toHaveBeenCalledWith(expect.anything(), 'user-1', { activeCompanyId: ACTIVE })
  })

  it('skips the allowlist query when there are no keys', async () => {
    setupFrom({ listResult: { data: [] } })
    const res = await GET(createMockRequest('/api/settings/api-keys'), noParams)
    const { status, body } = await parseJsonResponse<{ data: unknown[]; meta: { companies: unknown[] } }>(res)
    expect(status).toBe(200)
    expect(body.data).toEqual([])
    expect(body.meta.companies).toHaveLength(1)
    expect(serviceSupabase.from).not.toHaveBeenCalled()
  })
})

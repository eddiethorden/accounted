import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueuedMockSupabase } from '@/tests/helpers'

vi.mock('@/lib/arkiv/map', () => ({ buildArkivMap: vi.fn() }))
import { buildArkivMap } from '@/lib/arkiv/map'
import { loadAgentBundle, loadAgentsOverview } from '../agent-bundle'

const { supabase, enqueue, reset } = createQueuedMockSupabase()

const atom = (id: string, extra: Record<string, unknown> = {}) => ({
  id, tier: id.startsWith('vertical/') ? 'vertical' : 'horizontal', title: id.split('/').pop(), description: `About ${id}. More text.`,
  version: 3, reviewed_at: '2026-09-02', is_active: true, mcp_exposed: true, parent_atom_id: id.split('/').length > 2 ? id.split('/').slice(0, 2).join('/') : null, ...extra,
})

beforeEach(() => { reset(); vi.mocked(buildArkivMap).mockReset() })

describe('loadAgentsOverview', () => {
  it('attaches knowledge, company atoms and connection states to every agent', async () => {
    enqueue({ data: { vertical_atoms: ['vertical/konsult-it'], modifier_atoms: [] } })
    enqueue({ data: [
      atom('horizontal/swedish-vat'), atom('horizontal/swedish-accounting-compliance'),
      atom('horizontal/swedish-vat/vat-compliance-reference'),
      atom('horizontal/swedish-payroll', { is_active: false }),
      atom('vertical/konsult-it'),
    ] })
    enqueue({ count: 1 }) // bank_connections
    enqueue({ data: [] }) // skatteverket_tokens
    enqueue({ data: null }) // peppol_access
    enqueue({ data: [{ predicate: 'vat_period' }, { predicate: 'vat_method' }, { predicate: 'board' }] }) // company_facts
    enqueue({ count: 2 }) // agreements
    enqueue({ count: 5 }) // agent_memory
    enqueue({ count: 300 }) // document_attachments
    const overview = await loadAgentsOverview(supabase as never, 'company-a')

    expect(overview).toMatchObject({ facts: 3, agreements: 2, remembered: 5, documents: 300 })
    const vat = overview.agents.find((a) => a.id === 'quarterly-vat-review')!
    expect(vat.knowledge.map((k) => k.id)).toEqual(['horizontal/swedish-vat', 'horizontal/swedish-accounting-compliance'])
    expect(vat.knowledge[0]).toMatchObject({ reviewed_at: '2026-09-02', version: 3, summary: 'About horizontal/swedish-vat. More text.' })
    expect(vat.references.map((r) => r.id)).toEqual(['horizontal/swedish-vat/vat-compliance-reference'])
    expect(vat.company).toEqual([{ id: 'vertical/konsult-it', title: 'konsult-it', tier: 'vertical' }])
    expect(vat.connections).toEqual([{ kind: 'skatteverket', status: 'missing', settings_href: '/settings/tax' }])
    // the VAT agent reads vat_period and vat_method, not the board
    expect(vat.facts_known).toBe(2)

    // a switched-off pack never shows as the agent's knowledge
    expect(overview.agents.find((a) => a.id === 'payroll-monthly')!.knowledge).toEqual([])
    const bookkeep = overview.agents.find((a) => a.id === 'bookkeep')!
    expect(bookkeep.connections).toEqual([{ kind: 'bank', status: 'connected' }, { kind: 'mail', status: 'in_ai' }])
  })

  it('reports a failed connection read as unknown, never as missing', async () => {
    enqueue({ data: null })
    enqueue({ data: [] })
    enqueue({ error: { message: 'boom' } })
    enqueue({ data: [{ status: 'active' }] })
    enqueue({ data: { status: 'enabled' } })
    enqueue({ error: { message: 'facts down' } })
    enqueue({ count: 0 })
    enqueue({ count: 0 })
    enqueue({ count: 0 })
    const overview = await loadAgentsOverview(supabase as never, 'company-a')
    const month = overview.agents.find((a) => a.id === 'month-end-close')!
    expect(month.connections).toEqual([{ kind: 'bank', status: 'unknown' }, { kind: 'skatteverket', status: 'connected' }])
    expect(overview.agents.find((a) => a.id === 'kreditfaktura-process')!.connections).toEqual([{ kind: 'peppol', status: 'connected' }])
  })
})

describe('loadAgentBundle', () => {
  it('inlines knowledge bodies and uses the client-specific Kvittojakten workflow', async () => {
    vi.mocked(buildArkivMap).mockRejectedValue(new Error('archive down'))
    enqueue({ data: null })
    enqueue({ data: [atom('horizontal/swedish-accounting-compliance', { body: '# BFL' }), atom('horizontal/swedish-invoice-compliance', { body: '# Faktura' })] })
    enqueue({ data: [atom('horizontal/swedish-invoice-compliance/invoice-rules')] })
    enqueue({ count: 0 })
    enqueue({ data: [] })
    enqueue({ data: null })
    enqueue({ data: null }) // profile summary
    enqueue({ data: [] }) // memory
    const bundle = await loadAgentBundle(supabase as never, 'company-a', 'kvittojakten', 'chatgpt')
    expect(bundle.workflow.slug).toBe('kvittojakten-chatgpt')
    expect(bundle.workflow.body.length).toBeGreaterThan(100)
    expect(bundle.knowledge.map((k) => [k.id, k.body])).toEqual([['horizontal/swedish-accounting-compliance', '# BFL'], ['horizontal/swedish-invoice-compliance', '# Faktura']])
    expect(bundle.references).toEqual([{ id: 'horizontal/swedish-invoice-compliance/invoice-rules', title: 'invoice-rules' }])
    expect(bundle.connections).toEqual([{ kind: 'mail', status: 'in_ai' }, { kind: 'browser', status: 'in_ai' }])
  })
})

describe('loadAgentBundle: company knowledge', () => {
  it('inlines the facts this agent acts on, in its order, with agreements only when it reads them', async () => {
    vi.mocked(buildArkivMap).mockResolvedValue({
      company: { name: 'Arcim Technology AB', org_number: '5595386219', record_ref: 'company:x' },
      documents: { total: 300, by_group: {} as never, latest: [] },
      agreements: [{ record_ref: 'agreement:1', title: 'Lån Almi', kind: 'loan', counterparty: 'Almi', amount: 10417, period: 'monthly', ends_on: '2031-02-02', next_payment: '2026-10-02' }],
      company_facts: [
        { predicate: 'board', label: 'Styrelse', value: 'A, B', valid_from: null },
        { predicate: 'accounting_method', label: 'Bokföringsmetod', value: 'Faktureringsmetoden', valid_from: null },
        { predicate: 'vat_method', label: 'Redovisningsmetod', value: 'Kontantmetoden', valid_from: '2025-10-09' },
      ],
      waiting: { questions: 0, findings: 0 },
      how_to: ['Find: accounted_search_records'],
    })
    const run = async (id: 'quarterly-vat-review' | 'year-end-close') => {
      enqueue({ data: null }); enqueue({ data: [] }); enqueue({ data: [] })
      enqueue({ count: 0 }); enqueue({ data: [] }); enqueue({ data: null })
      enqueue({ data: { profile_summary: 'IT-konsult i Stockholm.' } })
      enqueue({ data: [{ content: 'Representation bokförs alltid på 6071.' }] })
      return loadAgentBundle(supabase as never, 'company-a', id)
    }
    const vat = (await run('quarterly-vat-review')).company_knowledge
    expect(vat.facts.map((f) => f.label)).toEqual(['Redovisningsmetod', 'Bokföringsmetod'])
    expect(vat).not.toHaveProperty('agreements')
    expect(vat).toMatchObject({ name: 'Arcim Technology AB', onboarding_summary: 'IT-konsult i Stockholm.', remembered: ['Representation bokförs alltid på 6071.'], documents: { total: 300 } })
    const yearEnd = (await run('year-end-close')).company_knowledge
    expect(yearEnd.facts.map((f) => f.label)).toEqual(['Bokföringsmetod', 'Styrelse'])
    expect(yearEnd.agreements?.map((a) => a.title)).toEqual(['Lån Almi'])
  })
})

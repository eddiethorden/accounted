'use client'

/**
 * Internal demo route for the Agenter page. Auth-free via the /sandbox
 * middleware exemption; view logged out.
 *
 * Renders the real SkillsPage with example data: an IT consultancy AB with a
 * bank and Skatteverket connected, Peppol not, Claude connected, and one own
 * agent. Every /api call the page makes is answered in the browser from the
 * fixtures below; nothing reaches a server and nothing is written.
 */

import { useState } from 'react'
import { CompanyProvider } from '@/contexts/CompanyContext'
import { SkillsPage } from '@/components/skills/SkillsPage'
import { AGENTS } from '@/lib/agent-skills/agents'
import { REGISTRY_SKILLS } from '@/lib/agent-skills/registry'
import type { AgentsOverview, ConnectionStatus } from '@/lib/agent-skills/agent-bundle'

// Titles and versions as agent_atom_registry holds them on prod (2026-09-24).
const PACKS: Record<string, { title: string; version: number }> = {
  'horizontal/swedish-accounting-compliance': { title: 'Swedish Accounting Compliance', version: 5 },
  'horizontal/swedish-asset-accounting': { title: 'Swedish Asset Accounting', version: 4 },
  'horizontal/swedish-financial-reporting': { title: 'Swedish Financial Reporting', version: 3 },
  'horizontal/swedish-invoice-compliance': { title: 'Swedish Invoice Compliance', version: 9 },
  'horizontal/swedish-payroll': { title: 'Swedish Payroll', version: 5 },
  'horizontal/swedish-tax-planning': { title: 'Swedish Tax Planning', version: 3 },
  'horizontal/swedish-vat': { title: 'Swedish VAT', version: 4 },
  'horizontal/swedish-year-end-closing': { title: 'Swedish Year End Closing', version: 3 },
}
const WORKFLOW_VERSION = 4
const CONNECTIONS: Record<string, ConnectionStatus> = { bank: 'connected', skatteverket: 'connected', peppol: 'missing' }
const SETTINGS: Record<string, string> = { bank: '/settings/banking', skatteverket: '/settings/tax', peppol: '/settings/invoicing' }

const OVERVIEW: AgentsOverview = {
  facts: 3,
  agents: REGISTRY_SKILLS.map(({ id }) => ({
    id,
    workflow: { slug: id, version: WORKFLOW_VERSION },
    knowledge: AGENTS[id].knowledge.map((k) => ({ id: k, title: PACKS[k]?.title ?? k, summary: '', version: PACKS[k]?.version ?? 1, reviewed_at: null })),
    references: AGENTS[id].references.map((r) => ({ id: r, title: r.split('/').pop()!.replace(/-/g, ' ') })),
    company: [
      { id: 'vertical/konsult-it', title: 'IT-konsult & systemutvecklare (SNI 62)', tier: 'vertical' as const },
      { id: 'modifier/single-shareholder-ab-fmb', title: 'Aktiebolag med en aktieägare (fåmansbolag)', tier: 'modifier' as const },
    ],
    connections: AGENTS[id].connections.map((kind) => kind in CONNECTIONS
      ? { kind, status: CONNECTIONS[kind], ...(CONNECTIONS[kind] === 'missing' ? { settings_href: SETTINGS[kind] } : {}) }
      : { kind, status: 'in_ai' as const }),
  })),
}

const OWN_BODY = [
  '# Påminnelse om leverantörsfakturor',
  '',
  '## Steg',
  '1. Hämta obetalda leverantörsfakturor.',
  '2. Välj ut de som förfaller inom 7 dagar.',
  '3. Sortera på förfallodatum och räkna ut totalbeloppet.',
  '4. Visa listan och fråga om betalfil ska skapas.',
].join('\n')

const CATALOG = [
  { slug: 'own/demo-reminder', name: 'Påminnelse om leverantörsfakturor', summary: 'Listar obetalda leverantörsfakturor som förfaller inom en vecka.', tags: ['own'], tier: 'own', source: 'own', active: true, shareStatus: 'private', installations: [{ installation_id: '00000000-0000-4000-8000-000000000001', scope: 'company' }] },
]

function json(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function installFixtures() {
  const real = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.origin)
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return real(input, init)
    if (init?.method && init.method !== 'GET') return json({ id: 'demo' })
    switch (url.pathname) {
      case '/api/ai/connections': return json(['claude'])
      case '/api/agents': return json(OVERVIEW)
      case '/api/worklist/counts': return json({ counts: { book_transaction: 42, verifikat_missing_document: 9, inbox_document: 3 } })
      case '/api/skills/usage': return json({ bookkeep: { count: 12, last_at: '2026-09-22T09:14:00Z' }, 'quarterly-vat-review': { count: 2, last_at: '2026-08-12T08:00:00Z' } })
      case '/api/skills': return url.searchParams.get('slug') === 'own/demo-reminder' ? json({ body: OWN_BODY }) : url.searchParams.get('slug') ? json({ body: '# Accounted workflow' }) : json(CATALOG)
      default: return json(null)
    }
  }
}

const COMPANY = {
  company: { id: 'demo-company', name: 'Exempelbolaget AB', entity_type: 'aktiebolag' } as never,
  role: 'owner' as const,
  companies: [],
  isTeamMember: false,
  team: null,
  isSandbox: false,
  capabilities: [],
  assistantAvailable: false,
  trialEndsAt: null,
  entitlementState: 'active' as never,
  trialExpiredAt: null,
}

export default function AgenterSandboxPage() {
  useState(() => { if (typeof window !== 'undefined') installFixtures() })
  return (
    <CompanyProvider value={COMPANY as never}>
      <div className="min-h-screen bg-background px-4 py-6 md:px-8">
        <p className="mb-4 text-xs text-muted-foreground">Demo: Exempelbolaget AB, exempeldata. Inget sparas.</p>
        <SkillsPage />
      </div>
    </CompanyProvider>
  )
}

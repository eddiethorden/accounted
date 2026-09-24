'use client'

/**
 * Fixtures for the /sandbox/agenter demo (list and agent pages). Auth-free via
 * the /sandbox middleware exemption. Every /api call the pages make is answered
 * in the browser; nothing reaches a server and nothing is written. Knowledge
 * choices are kept in the page so add, remove and reset can be tried.
 */

import { useState, type ReactNode } from 'react'
import { CompanyProvider } from '@/contexts/CompanyContext'
import DashboardNav from '@/components/dashboard/DashboardNav'
import { AgentSheetProvider } from '@/components/agent/AgentSheetProvider'
import { AGENTS } from '@/lib/agent-skills/agents'
import { REGISTRY_SKILLS } from '@/lib/agent-skills/registry'
import type { AgentsOverview, ConnectionStatus } from '@/lib/agent-skills/agent-bundle'
import type { KnowledgeOption } from '@/lib/agent-skills/knowledge-choices'

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

// Company facts the demo company holds (predicates from lib/arkiv/facts/predicates.ts).
const KNOWN_FACTS = new Set(['legal_name', 'org_number', 'fiscal_year', 'vat_registered', 'vat_period', 'vat_method', 'accounting_method', 'f_skatt', 'sni_codes', 'board', 'share_capital', 'bank_connection', 'monthly_cost_baseline', 'top_counterparty'])

// Every pack a company can choose, as the registry lists them on prod (titles, 2026-09-24).
const OPTIONS: KnowledgeOption[] = [
  ...Object.entries(PACKS).map(([id, p]) => ({ id, tier: 'horizontal' as const, title: p.title, summary: '', version: p.version, reviewed_at: null })),
  { id: 'horizontal/swedish-e-invoicing', tier: 'horizontal', title: 'Swedish E Invoicing', summary: 'Peppol, e-faktura och krav vid offentlig sektor.', version: 7, reviewed_at: null },
  { id: 'horizontal/swedish-sie-import-export', tier: 'horizontal', title: 'Swedish SIE Import Export', summary: 'SIE-filer vid byte av bokföringsprogram.', version: 4, reviewed_at: null },
  { id: 'horizontal/swedish-project-accounting', tier: 'horizontal', title: 'Swedish Project Accounting', summary: 'Projekt, pågående arbeten och bidrag.', version: 3, reviewed_at: null },
  { id: 'horizontal/swedish-sru-filing', tier: 'horizontal', title: 'Swedish SRU Filing', summary: 'SRU-koder till Skatteverket.', version: 7, reviewed_at: null },
  { id: 'vertical/bygg-hantverk', tier: 'vertical', title: 'Bygg & hantverk (SNI 41-43)', summary: 'Omvänd moms i byggsektorn, ROT och pågående arbeten.', version: 3, reviewed_at: null },
  { id: 'vertical/e-handel', tier: 'vertical', title: 'E-handel & näthandel (SNI 47.91 / 47.99)', summary: 'OSS, marknadsplatser och betalleverantörer.', version: 3, reviewed_at: null },
  { id: 'vertical/konsult-it', tier: 'vertical', title: 'IT-konsult & systemutvecklare (SNI 62)', summary: '3:12, konsult eller anställd, elektroniska tjänster.', version: 3, reviewed_at: null },
  { id: 'vertical/reklambyra-marknadsforing', tier: 'vertical', title: 'Reklambyrå & marknadsföring', summary: 'Vidarefakturering och mediainköp.', version: 3, reviewed_at: null },
  { id: 'vertical/restaurang-cafe', tier: 'vertical', title: 'Restaurang & café (SNI 56)', summary: 'Moms på servering och avhämtning, kassaregister och personalliggare.', version: 1, reviewed_at: null },
  { id: 'vertical/vard-halsa', tier: 'vertical', title: 'Vård, tandvård & skönhet (SNI 86)', summary: 'Momsfri vård, blandad verksamhet och frisörer.', version: 1, reviewed_at: null },
  { id: 'vertical/software-saas-ai', tier: 'vertical', title: 'Software, SaaS & AI-produktbolag', summary: 'Prenumerationsintäkter och aktivering av utveckling.', version: 2, reviewed_at: null },
  { id: 'modifier/holding-ab', tier: 'modifier', title: 'Holdingbolag (rena ägar-/förvaltningsbolag)', summary: 'Koncernbidrag, näringsbetingade andelar, moms för holding.', version: 3, reviewed_at: null },
  { id: 'modifier/mixed-verksamhet', tier: 'modifier', title: 'Blandad verksamhet (moms-split)', summary: 'Fördelningsnyckel och jämkning.', version: 3, reviewed_at: null },
  { id: 'modifier/single-shareholder-ab-fmb', tier: 'modifier', title: 'Aktiebolag med en aktieägare (fåmansbolag)', summary: 'Lön eller utdelning, 3:12.', version: 4, reviewed_at: null },
]

// What the demo company changed, kept in the page: add, remove and reset work without a server.
const choices = new Map<string, { added: string[]; removed: Set<string> }>([['bookkeep', { added: ['vertical/konsult-it'], removed: new Set() }]])

function knowledgeFor(defaults: readonly string[], agentId: string) {
  const choice = choices.get(agentId)
  const option = (id: string) => OPTIONS.find((o) => o.id === id)!
  return [
    ...defaults.filter((k) => !choice?.removed.has(k)).map((k) => ({ ...option(k), source: 'default' as const })),
    ...(choice?.added ?? []).filter((k) => !defaults.includes(k)).map((k) => ({ ...option(k), source: 'added' as const })),
  ]
}

function applyChoice(body: { action: 'add' | 'remove' | 'reset'; agent_id: string; atom_id?: string }) {
  const defaults = body.agent_id in AGENTS ? AGENTS[body.agent_id as keyof typeof AGENTS].knowledge : []
  const choice = choices.get(body.agent_id) ?? { added: [], removed: new Set<string>() }
  if (body.action === 'reset') { choices.delete(body.agent_id); return }
  const id = body.atom_id!
  if (body.action === 'add') { choice.removed.delete(id); if (!defaults.includes(id) && !choice.added.includes(id)) choice.added.push(id) }
  else { choice.added = choice.added.filter((a) => a !== id); if (defaults.includes(id)) choice.removed.add(id) }
  choices.set(body.agent_id, choice)
}

function overview(): AgentsOverview {
  return {
    ...OVERVIEW,
    own_knowledge: { 'own/00000000-0000-4000-8000-000000000001': knowledgeFor([], 'own/00000000-0000-4000-8000-000000000001') },
    agents: OVERVIEW.agents.map((a) => ({ ...a, knowledge: knowledgeFor(AGENTS[a.id].knowledge, a.id), references: a.references.filter((r) => knowledgeFor(AGENTS[a.id].knowledge, a.id).some((k) => k.id === r.id.split('/').slice(0, 2).join('/'))), removed: AGENTS[a.id].knowledge.filter((k) => choices.get(a.id)?.removed.has(k)) })),
  }
}

const OVERVIEW: AgentsOverview = {
  facts: KNOWN_FACTS.size,
  agreements: 2,
  remembered: 4,
  documents: 312,
  own_knowledge: { 'own/00000000-0000-4000-8000-000000000001': [{ id: 'horizontal/swedish-invoice-compliance', tier: 'horizontal', source: 'added', title: 'Swedish Invoice Compliance', summary: '', version: 9, reviewed_at: null }] },
  agents: REGISTRY_SKILLS.map(({ id }) => ({
    id,
    workflow: { slug: id, version: WORKFLOW_VERSION },
    facts_known: AGENTS[id].facts.filter((f) => KNOWN_FACTS.has(f)).length,
    knowledge: [
      ...AGENTS[id].knowledge.map((k) => ({ id: k, tier: 'horizontal', source: 'default' as const, title: PACKS[k]?.title ?? k, summary: '', version: PACKS[k]?.version ?? 1, reviewed_at: null })),
      ...(id === 'bookkeep' ? [{ id: 'vertical/konsult-it', tier: 'vertical', source: 'added' as const, title: 'IT-konsult & systemutvecklare (SNI 62)', summary: '', version: 3, reviewed_at: null }] : []),
    ],
    removed: [],
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

// Example community items (names, handles and counts are made up for the demo), one or more per kind.
type Shared = { kind: 'workflow' | 'rules' | 'analysis'; author: string; shared: number; verified?: boolean; votes: number; works: number; notWorks: number; area: string | null; industries?: string[]; uses?: string[]; usedBy?: number }
const shared = (slug: string, name: string, summary: string, m: Shared) => ({
  slug: `community/${slug}`, name, summary, tags: ['community'], tier: 'community', source: 'community', active: false, installations: [],
  community: {
    kind: m.kind, author: m.author, author_shared: m.shared, author_verified: !!m.verified, votes: m.votes, voted: false, works: m.works, not_works: m.notWorks,
    feedback: null, reviewed_at: '2026-09-18T10:00:00Z', area: m.area, industries: m.industries ?? [], uses: m.uses ?? [], used_by: m.usedBy ?? null,
  },
})
const KONSULT = 'vertical/konsult-it'
const RESTAURANG = 'vertical/restaurang-cafe'

// A pack's text as the AI reads it; in the app this comes from agent_atom_registry. Demo wording, not the real pack.
const PACK_BODY = [
  '# IT-konsult och systemutvecklare',
  '',
  'Läs det här när bolaget säljer konsulttjänster eller utvecklar system åt kunder.',
  '',
  '## Innehåll',
  '- Konsult eller anställd: vad som avgör och när det spelar roll',
  '- Tjänster till kunder i andra länder: hur fakturan och momsen ska se ut',
  '- Elektroniska tjänster och licenser',
  '- Utlägg som vidarefaktureras till kunden',
  '- Pågående uppdrag vid bokslut',
  '',
  '## Fördjupning',
  'Laddas bara när ett fall kräver det: 3:12, fakturering till utlandet, pågående arbeten.',
].join('\n')

const CATALOG = [
  shared('tid-till-faktura', 'Tidrapport till faktura', 'Månadens rapporterade timmar per kund blir fakturautkast, med rätt moms för tjänster till utlandet.', { kind: 'workflow', author: 'byra-lind', shared: 7, verified: true, votes: 57, works: 38, notWorks: 2, area: 'fakturering', industries: [KONSULT], uses: ['mail'], usedBy: 212 }),
  shared('stang-dagskassan', 'Stäng dagskassan', 'Z-rapporten till ett verifikat, med kort, Swish och kontant var för sig.', { kind: 'workflow', author: 'kafe-norr', shared: 4, votes: 48, works: 31, notWorks: 2, area: 'lopande', industries: [RESTAURANG], uses: ['zettle', 'bank'], usedBy: 96 }),
  shared('styrelserapport', 'Månadsrapport till styrelsen', 'Resultat, likviditet och avvikelser mot budget på en sida.', { kind: 'workflow', author: 'byra-lind', shared: 7, verified: true, votes: 22, works: 14, notWorks: 1, area: 'bokslut', usedBy: 41 }),
  shared('shopify-underlag', 'Shopify-order som underlag', 'Ordrar och utbetalningar från Shopify blir underlag i bokföringen.', { kind: 'workflow', author: 'butiken', shared: 1, votes: 12, works: 7, notWorks: 2, area: 'lopande', industries: ['vertical/e-handel'], uses: ['shopify', 'bank'], usedBy: 18 }),
  shared('dricks-kort', 'Dricks via kort till personalen', 'Hur dricks som kommer in via kortinlösen hanteras fram till lönen, med källor.', { kind: 'rules', author: 'bistro-ost', shared: 2, votes: 17, works: 9, notWorks: 1, area: 'lon', industries: [RESTAURANG] }),
  shared('konsult-vidarefakturering', 'Vidarefakturering av utlägg', 'När ett utlägg för kundens räkning ska med moms och när det inte ska det, med källor.', { kind: 'rules', author: 'byra-lind', shared: 7, verified: true, votes: 31, works: 19, notWorks: 0, area: 'fakturering', industries: [KONSULT] }),
  shared('ravaruprocent', 'Råvaruprocent per månad', 'Varuinköp mot försäljning, och vad som är normalt för en restaurang.', { kind: 'analysis', author: 'lunchkrogen', shared: 3, votes: 64, works: 40, notWorks: 3, area: 'analys', industries: [RESTAURANG], usedBy: 133 }),
  shared('debiteringsgrad', 'Debiteringsgrad och timpris', 'Fakturerade timmar mot arbetade, och vad det betyder för timpriset.', { kind: 'analysis', author: 'byra-lind', shared: 7, verified: true, votes: 44, works: 29, notWorks: 1, area: 'analys', industries: [KONSULT], usedBy: 87 }),
  shared('kassaflode-13', 'Kassaflöde 13 veckor framåt', 'Kända in- och utbetalningar vecka för vecka, med varning när saldot blir lågt.', { kind: 'analysis', author: 'byra-lind', shared: 7, verified: true, votes: 41, works: 25, notWorks: 2, area: 'analys', uses: ['bank'], usedBy: 154 }),
  shared('personalkostnad', 'Personalkostnad per omsättningskrona', 'Löner och avgifter mot omsättning, månad för månad.', { kind: 'analysis', author: 'kafe-norr', shared: 4, votes: 29, works: 18, notWorks: 4, area: 'analys' }),
  { slug: 'own/00000000-0000-4000-8000-000000000001', name: 'Påminnelse om leverantörsfakturor', summary: 'Listar obetalda leverantörsfakturor som förfaller inom en vecka.', tags: ['own'], tier: 'own', source: 'own', active: true, shareStatus: 'private', installations: [{ installation_id: '00000000-0000-4000-8000-000000000001', scope: 'company' }] },
]

function json(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function installFixtures() {
  const real = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.origin)
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return real(input, init)
    if (url.pathname === '/api/agents/knowledge' && init?.method === 'PATCH') { applyChoice(JSON.parse(String(init.body))); return json({ ok: true }) }
    // Votes and "fungerar" answers are kept by the page itself in the demo.
    if (url.pathname === '/api/agents/community/feedback') return json({ ok: true })
    if (init?.method && init.method !== 'GET') return json({ id: 'demo' })
    switch (url.pathname) {
      case '/api/ai/connections': return json(['claude'])
      case '/api/agents': return json(overview())
      case '/api/agents/knowledge': return json(OPTIONS)
      case '/api/worklist/counts': return json({ counts: { book_transaction: 42, verifikat_missing_document: 9, inbox_document: 3 } })
      case '/api/skills/usage': return json({ bookkeep: { count: 12, last_at: '2026-09-22T09:14:00Z' }, 'quarterly-vat-review': { count: 2, last_at: '2026-08-12T08:00:00Z' } })
      case '/api/skills': {
        const slug = url.searchParams.get('slug')
        if (!slug) return json(CATALOG)
        if (slug === 'own/00000000-0000-4000-8000-000000000001') return json({ body: OWN_BODY })
        if (slug === 'vertical/konsult-it') return json({ body: PACK_BODY })
        const pack = OPTIONS.find((o) => o.id === slug)
        if (pack) return json({ body: `# ${pack.title}\n\nI appen visas packets egen text här, samma text som din AI läser.` })
        const item = CATALOG.find((c) => c.slug === slug)
        return json({ body: item ? `# ${item.name}\n\n${item.summary}` : '# Accounted workflow' })
      }
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


let installed = false

/** The demo company around a page, with the fixture API installed once. */
// The dashboard panel's classes (app/(dashboard)/layout.tsx MAIN_PANEL_CLASS), copied: that layout is a server module.
const MAIN_PANEL_CLASS =
  'safe-area-main-padding md:!pb-0 relative bg-background min-h-dvh ' +
  'md:min-h-0 md:ml-[var(--nav-w)] md:mt-[10px] md:mr-[var(--agent-dock-w)] md:h-[calc(100vh-20px)] ' +
  'md:overflow-y-auto md:rounded-xl md:border md:border-border'

export function SandboxShell({ children }: { children: ReactNode }) {
  useState(() => { if (typeof window !== 'undefined' && !installed) { installFixtures(); installed = true } })
  return (
    <CompanyProvider value={COMPANY as never}>
      <AgentSheetProvider>
        {/* The dashboard's own frame (app/(dashboard)/layout.tsx): the real sidebar and the rounded panel, so the demo reads as the page will in the app. */}
        <div className="min-h-dvh bg-frame md:flex md:flex-col">
          <DashboardNav companyName="Exempelbolaget AB" entityType="aktiebolag" agentsEnabled userName="Demo, inget sparas" />
          <main id="main-content" className={MAIN_PANEL_CLASS} role="main">
            <div className="px-4 pb-8 pt-4 md:px-6">
              {children}
            </div>
          </main>
        </div>
      </AgentSheetProvider>
    </CompanyProvider>
  )
}

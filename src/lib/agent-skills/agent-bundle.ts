import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiClient } from '@/lib/onboarding/ai-clients'
import { AGENTS, CONNECTION_SETTINGS, isCheckable, type AgentConnection, type CheckableConnection } from './agents'
import { REGISTRY_SKILLS, registrySkillSlug, type RegistrySkillId } from './registry'
import { toSummary } from './atoms'
import { workflowSkills } from './workflows'
import { kvittojaktenSkills } from './workflows/kvittojakten'
import type { Skill } from './types'
import { buildArkivMap, type ArkivMap } from '@/lib/arkiv/map'

export type ConnectionStatus = 'connected' | 'missing' | 'in_ai' | 'unknown'

export interface AgentConnectionState {
  kind: AgentConnection
  status: ConnectionStatus
  /** Where to fix a missing Accounted connection. */
  settings_href?: string
}

export interface KnowledgeMeta {
  id: string
  title: string
  summary: string
  version: number | null
  reviewed_at: string | null
}

export interface AgentOverview {
  id: RegistrySkillId
  workflow: { slug: string; version: number | null }
  /** How many of the company facts this agent reads are known for the company. */
  facts_known: number
  knowledge: KnowledgeMeta[]
  references: Array<{ id: string; title: string }>
  company: Array<{ id: string; title: string; tier: 'vertical' | 'modifier' }>
  connections: AgentConnectionState[]
}

export interface AgentsOverview {
  agents: AgentOverview[]
  /** Confirmed company facts the agent sees in its briefing. */
  facts: number
  /** Running agreements read from the company's documents. */
  agreements: number
  /** What agents remember about the company (remember_fact). */
  remembered: number
  /** Documents an agent can search and read. */
  documents: number
}

interface AtomRow {
  id: string
  tier: string
  title: string | null
  description: string
  version: number | null
  reviewed_at: string | null
  is_active: boolean
  mcp_exposed: boolean
  parent_atom_id: string | null
  body?: string | null
}

const ATOM_META = 'id, tier, title, description, version, reviewed_at, is_active, mcp_exposed, parent_atom_id'

function workflowFor(id: RegistrySkillId, client: AiClient): Skill {
  const slug = registrySkillSlug(id, client)
  const skill = [...workflowSkills, ...kvittojaktenSkills].find((s) => s.slug === slug)
  if (!skill) throw new Error(`Agent ${id} has no workflow ${slug}`)
  return skill
}

function meta(row: AtomRow): KnowledgeMeta {
  return { id: row.id, title: row.title ?? row.id, summary: toSummary(row.description, 160), version: row.version, reviewed_at: row.reviewed_at }
}

/** Live rows only: a withdrawn or unexposed atom never reaches an agent (the kill switch). */
async function loadAtoms(supabase: SupabaseClient, ids: string[], withBody: boolean): Promise<Map<string, AtomRow>> {
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase.from('agent_atom_registry')
    .select(withBody ? `${ATOM_META}, body` : ATOM_META).in('id', ids)
  if (error) throw new Error(`Failed to load agent knowledge: ${error.message}`)
  const rows = (data ?? []) as unknown as AtomRow[]
  return new Map(rows.filter((row) => row.is_active && row.mcp_exposed).map((row) => [row.id, row]))
}

async function loadProfileAtoms(supabase: SupabaseClient, companyId: string): Promise<string[]> {
  const { data, error } = await supabase.from('agent_profiles').select('vertical_atoms, modifier_atoms').eq('company_id', companyId).maybeSingle()
  if (error) throw error
  return [...(data?.vertical_atoms ?? []), ...(data?.modifier_atoms ?? [])]
}

/** A failed read says "unknown", never "missing": the page must not tell a connected user to connect. */
async function loadConnectionStates(supabase: SupabaseClient, companyId: string): Promise<Record<CheckableConnection, ConnectionStatus>> {
  const [bank, skv, peppol] = await Promise.all([
    supabase.from('bank_connections').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'active'),
    supabase.from('skatteverket_tokens').select('status').eq('company_id', companyId),
    supabase.from('peppol_access').select('status').eq('company_id', companyId).maybeSingle(),
  ])
  return {
    bank: bank.error ? 'unknown' : (bank.count ?? 0) > 0 ? 'connected' : 'missing',
    skatteverket: skv.error ? 'unknown' : (skv.data ?? []).some((row) => (row.status ?? 'active') === 'active') ? 'connected' : 'missing',
    peppol: peppol.error ? 'unknown' : peppol.data?.status === 'enabled' ? 'connected' : 'missing',
  }
}

function connectionsFor(id: RegistrySkillId, states: Record<CheckableConnection, ConnectionStatus>): AgentConnectionState[] {
  return AGENTS[id].connections.map((kind) => isCheckable(kind)
    ? { kind, status: states[kind], ...(states[kind] === 'missing' ? { settings_href: CONNECTION_SETTINGS[kind] } : {}) }
    : { kind, status: 'in_ai' as const })
}

function companyAtoms(atoms: Map<string, AtomRow>, profileIds: string[]): AgentOverview['company'] {
  return profileIds.flatMap((pid) => {
    const row = atoms.get(pid)
    return row && (row.tier === 'vertical' || row.tier === 'modifier') ? [{ id: row.id, title: row.title ?? row.id, tier: row.tier }] : []
  })
}

/** Every curated agent with its knowledge, the company's own atoms and connection states. No bodies. */
export async function loadAgentsOverview(supabase: SupabaseClient, companyId: string, client: AiClient = 'claude'): Promise<AgentsOverview> {
  const profileIds = await loadProfileAtoms(supabase, companyId)
  const ids = [...new Set([...Object.values(AGENTS).flatMap((a) => [...a.knowledge, ...a.references]), ...profileIds])]
  const [atoms, states, facts, agreements, remembered, documents] = await Promise.all([
    loadAtoms(supabase, ids, false),
    loadConnectionStates(supabase, companyId),
    supabase.from('company_facts').select('predicate').eq('company_id', companyId).eq('subject_kind', 'company').is('sys_to', null).neq('rank', 'deprecated').eq('status', 'confirmed').limit(500),
    supabase.from('agreements').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'active'),
    supabase.from('agent_memory').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('is_active', true),
    supabase.from('document_attachments').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('admission_state', 'admitted'),
  ])
  const company = companyAtoms(atoms, profileIds)
  const known = new Set(facts.error ? [] : ((facts.data ?? []) as Array<{ predicate: string }>).map((f) => f.predicate))
  return {
    facts: known.size,
    agreements: agreements.error ? 0 : agreements.count ?? 0,
    remembered: remembered.error ? 0 : remembered.count ?? 0,
    documents: documents.error ? 0 : documents.count ?? 0,
    agents: REGISTRY_SKILLS.map(({ id }) => {
      const def = AGENTS[id]
      const workflow = workflowFor(id, client)
      return {
        id,
        workflow: { slug: workflow.slug, version: workflow.version ?? null },
        facts_known: def.facts.filter((f) => known.has(f)).length,
        knowledge: def.knowledge.flatMap((k) => { const row = atoms.get(k); return row ? [meta(row)] : [] }),
        references: def.references.flatMap((r) => { const row = atoms.get(r); return row ? [{ id: row.id, title: row.title ?? row.id }] : [] }),
        company,
        connections: connectionsFor(id, states),
      }
    }),
  }
}

/**
 * What we know about the company, cut to what this agent acts on. Registry and
 * ledger facts, the owner's documents (agreements) and what agents were told
 * (remembered) arrive inline; the archive itself stays one lookup away.
 */
export interface CompanyKnowledge {
  name: string | null
  org_number: string | null
  /** The onboarding text (agent_profiles.profile_summary): written once, addressed to the owner, may be outdated. */
  onboarding_summary: string | null
  facts: Array<{ label: string; value: string; valid_from: string | null }>
  agreements?: ArkivMap['agreements']
  remembered: string[]
  documents: { total: number; look_up: string[] }
}

export interface AgentBundle {
  agent: { id: RegistrySkillId; name: string }
  workflow: { slug: string; version: number | null; body: string }
  knowledge: Array<KnowledgeMeta & { body: string }>
  references: Array<{ id: string; title: string }>
  company: AgentOverview['company']
  company_knowledge: CompanyKnowledge
  connections: AgentConnectionState[]
}

const REMEMBERED = 10

async function loadCompanyKnowledge(supabase: SupabaseClient, companyId: string, id: RegistrySkillId): Promise<CompanyKnowledge> {
  const def = AGENTS[id]
  const [map, profile, memory] = await Promise.all([
    // The map is best-effort: an archive that cannot be read never blocks the agent.
    buildArkivMap(supabase, companyId).catch(() => null),
    supabase.from('agent_profiles').select('profile_summary').eq('company_id', companyId).maybeSingle(),
    supabase.from('agent_memory').select('content').eq('company_id', companyId).eq('is_active', true)
      .order('relevance_score', { ascending: false, nullsFirst: false }).limit(REMEMBERED),
  ])
  const order = new Map(def.facts.map((f, i) => [f, i]))
  const facts = (map?.company_facts ?? [])
    .filter((f) => order.has(f.predicate))
    .sort((a, b) => order.get(a.predicate)! - order.get(b.predicate)!)
    .map(({ label, value, valid_from }) => ({ label, value, valid_from }))
  return {
    name: map?.company.name ?? null,
    org_number: map?.company.org_number ?? null,
    onboarding_summary: profile.error ? null : profile.data?.profile_summary ?? null,
    facts,
    ...(def.agreements ? { agreements: map?.agreements ?? [] } : {}),
    remembered: memory.error ? [] : ((memory.data ?? []) as Array<{ content: string }>).map((m) => m.content),
    documents: { total: map?.documents.total ?? 0, look_up: map?.how_to ?? [] },
  }
}

export function isAgentId(value: string): value is RegistrySkillId {
  return value in AGENTS
}

/**
 * One agent, ready to run: the workflow body, its knowledge cores inlined, the
 * references and company atoms as ids to load with load_skill when needed.
 */
export async function loadAgentBundle(supabase: SupabaseClient, companyId: string, id: RegistrySkillId, client: AiClient = 'claude'): Promise<AgentBundle> {
  const def = AGENTS[id]
  const profileIds = await loadProfileAtoms(supabase, companyId)
  const [cores, metaRows, states, companyKnowledge] = await Promise.all([
    loadAtoms(supabase, [...def.knowledge], true),
    loadAtoms(supabase, [...def.references, ...profileIds], false),
    loadConnectionStates(supabase, companyId),
    loadCompanyKnowledge(supabase, companyId, id),
  ])
  const workflow = workflowFor(id, client)
  return {
    agent: { id, name: workflow.name },
    workflow: { slug: workflow.slug, version: workflow.version ?? null, body: workflow.body },
    knowledge: def.knowledge.flatMap((k) => { const row = cores.get(k); return row?.body ? [{ ...meta(row), body: row.body }] : [] }),
    references: def.references.flatMap((r) => { const row = metaRows.get(r); return row ? [{ id: row.id, title: row.title ?? row.id }] : [] }),
    company: companyAtoms(metaRows, profileIds),
    company_knowledge: companyKnowledge,
    connections: connectionsFor(id, states),
  }
}

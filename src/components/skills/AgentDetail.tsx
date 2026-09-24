'use client'

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import useSWR from 'swr'
import { ArrowLeft, ArrowUpRight, Check, ChevronLeft, FileText, Globe, Landmark, Plus, Search, X } from 'lucide-react'
import { useCompany } from '@/contexts/CompanyContext'
import { useCanWrite } from '@/lib/hooks/use-can-write'
import { useBranding } from '@/lib/branding/brand-context'
import { useCashAccounts } from '@/lib/reference-data/hooks'
import { bankLogoUrl } from '@/lib/reconciliation/bank-logos'
import { AGENTS, CONNECTION_SETTINGS, isAgentId, isCheckable, type AgentConnection } from '@/lib/agent-skills/agents'
import type { AgentConnectionState, KnowledgeMeta } from '@/lib/agent-skills/agent-bundle'
import type { KnowledgeAction, KnowledgeOption } from '@/lib/agent-skills/knowledge-choices'
import { registrySkillSlug, skillsToDoNow, type RegistrySkillId } from '@/lib/agent-skills/registry'
import { ownSkillSteps } from '@/lib/agent-skills/own-skill-body'
import { AI_CLIENTS, aiConnectAction, openAiConnector, pickConnectedAiClient, type AiClient } from '@/lib/onboarding/ai-clients'
import { formatDateLong } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { DestructiveConfirmDialog } from '@/components/ui/destructive-confirm-dialog'
import { AgentOrb, huesFor } from './AgentOrb'
import { GmailMark } from './SkillMarks'
import { useKnowledgeDesc, useKnowledgeName } from './knowledge-labels'
import { copyPromptAndOpen } from './run'
import { agentIdFromSegment, agentStatus, fetchConnections, readAgents, readCatalog, readOptions, readUsage, readWorklist, simulatedClient, type SkillSummary } from './data'
import styles from './skills.module.css'

type View = 'main' | 'knowledge' | 'apps'
type Own = SkillSummary & { installations: [{ installation_id: string }] }

async function readBody(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Skill body request failed')
  return ((await response.json()).data as { body: string }).body
}

/**
 * One agent's page, as in Oasis: its orb on a stage with the run button to
 * the left, and to the right what it is made of: instructions, connections,
 * knowledge and what it knows about the company. Adding knowledge or a
 * connection turns the right panel into a searchable grid instead of a menu.
 */
export function AgentDetail({ segment, backHref = '/skills' }: { segment: string; backHref?: string }) {
  const { company } = useCompany()
  return company ? <Detail key={`${company.id}:${segment}`} companyId={company.id} agentId={agentIdFromSegment(segment)} backHref={backHref} /> : null
}

function Detail({ companyId, agentId, backHref }: { companyId: string; agentId: string; backHref: string }) {
  const t = useTranslations('skills_registry')
  const locale = useLocale()
  const router = useRouter()
  const { canWrite } = useCanWrite()
  const { appName } = useBranding()
  const curated = isAgentId(agentId) ? agentId as RegistrySkillId : null

  // ── the AI connection, read once and whenever the user comes back ──
  const [connected, setConnected] = useState<AiClient[] | null>(null)
  useEffect(() => {
    const simulated = simulatedClient()
    const controller = new AbortController()
    const check = () => { if (document.visibilityState !== 'hidden') void (simulated ? Promise.resolve([simulated]) : fetchConnections(controller.signal)).then((list) => { if (list) setConnected(list) }) }
    check()
    window.addEventListener('focus', check)
    return () => { controller.abort(); window.removeEventListener('focus', check) }
  }, [])
  const client = pickConnectedAiClient(connected ?? []) ?? 'claude'
  const clientName = AI_CLIENTS.find((c) => c.id === client)!.name

  const catalog = useSWR(['/api/skills', companyId], ([url]) => readCatalog(url))
  const agents = useSWR(['/api/agents', companyId, client], ([url, , c]) => readAgents(`${url}?client=${c}`))
  const options = useSWR(['/api/agents/knowledge', companyId], ([url]) => readOptions(url))
  const worklist = useSWR(['/api/worklist/counts', companyId], ([url]) => readWorklist(url))
  const usage = useSWR(['/api/skills/usage', companyId], ([url]) => readUsage(url))
  const own = curated ? null : (catalog.data ?? []).find((s): s is Own => s.slug === agentId && !!s.installations[0]) ?? null
  const overview = curated ? agents.data?.agents.find((a) => a.id === curated) : undefined
  const bodySlug = curated ? registrySkillSlug(curated, client) : agentId
  const body = useSWR(curated || own ? ['/api/skills', companyId, bodySlug] : null, ([url, , s]) => readBody(`${url}?slug=${encodeURIComponent(s)}`))
  const [view, setView] = useState<View>('main')
  const [runState, setRunState] = useState<'idle' | 'copied' | 'failed'>('idle')

  if (!curated && catalog.data && !own) {
    return (
      <div className={styles.apage}>
        <PageHeader title={t('title')} />
        <Link href={backHref} className={styles.back}><ArrowLeft className="h-4 w-4" aria-hidden />{t('back_to_agents')}</Link>
        <p className={styles.muted}>{t('not_found')}</p>
      </div>
    )
  }

  const hues = curated ? AGENTS[curated].orb : huesFor(agentId)
  const name = curated ? t(`skills.${curated}.agent`) : own?.name ?? ''
  const task = curated ? t(`skills.${curated}.name`) : null
  const desc = curated ? t(`skills.${curated}.desc`) : own ? t(own.draft ? 'draft_desc' : 'own_desc') : ''
  const steps = curated ? (t.raw(`skills.${curated}.steps`) as string[]) : body.data ? ownSkillSteps(body.data) : []
  const knowledge: KnowledgeMeta[] = curated ? overview?.knowledge ?? [] : agents.data?.own_knowledge[agentId] ?? []
  const connections: AgentConnectionState[] = overview?.connections ?? []
  const changed = knowledge.some((k) => k.source === 'added') || (overview?.removed.length ?? 0) > 0
  const status = curated ? agentStatus({
    id: curated,
    aiKnown: connected === null ? null : connected.length > 0,
    overview: agents.data,
    waiting: skillsToDoNow(worklist.data ?? {}).get(curated),
    lastAt: usage.data?.[curated]?.last_at,
    t: (key, values) => t(key, values),
    formatDate: (iso) => formatDateLong(iso, locale),
  }) : undefined
  const canEdit = canWrite && !own?.draft

  async function changeKnowledge(action: KnowledgeAction, atomId?: string): Promise<boolean> {
    try {
      const response = await fetch('/api/agents/knowledge', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(atomId ? { action, agent_id: agentId, atom_id: atomId } : { action, agent_id: agentId }) })
      if (!response.ok) return false
      await agents.mutate()
      return true
    } catch {
      return false
    }
  }
  async function patchOwn(payload: object): Promise<boolean> {
    if (!own) return false
    try {
      const response = await fetch(`/api/skills/${own.installations[0].installation_id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!response.ok) return false
      await catalog.mutate()
      return true
    } catch {
      return false
    }
  }
  async function deleteOwn(): Promise<boolean> {
    if (!own) return false
    try {
      const response = await fetch(`/api/skills/${own.installations[0].installation_id}`, { method: 'DELETE' })
      if (!response.ok) return false
      await catalog.mutate()
      router.push(backHref)
      return true
    } catch {
      return false
    }
  }

  function run() {
    if (connected !== null && connected.length === 0) {
      openAiConnector(aiConnectAction('claude', { origin: window.location.origin, appName }).open)
      return
    }
    const say = curated ? t(`skills.${curated}.say`) : t('own_say', { name })
    // Curated agents open with the prompt typed in; an own agent's prompt carries the name the user wrote, so it is copied.
    void copyPromptAndOpen(t('prompt', { say, agent: agentId, client }), client, !!curated).then((ok) => setRunState(ok ? 'copied' : 'failed'))
  }
  const disconnected = connected !== null && connected.length === 0

  return (
    <div className={styles.apage}>
      <PageHeader title={t('title')} />
      <Link href={backHref} className={styles.back}><ArrowLeft className="h-4 w-4" aria-hidden />{t('back_to_agents')}</Link>
      <div className={styles.agrid2}>
        <section className={styles.stage} style={{ '--h1': hues[0], '--h2': hues[1], '--h3': hues[2] } as CSSProperties} aria-label={name}>
          <div className={styles.stageTile}>
            <AgentOrb hues={hues} presence={status?.presence} size="lg" />
            <b data-ph-mask={own ? '' : undefined}>{name}</b>
            {task && <small>{task}</small>}
          </div>
          <div className={styles.stageFoot}>
            <Button size="lg" className="gap-2" onClick={run}>
              {disconnected ? t('connect_client', { client: 'Claude' }) : t('run_agent', { client: clientName })}
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </Button>
            {status && <span className={styles.stageStatus}><span className={styles.chipDot} data-presence={status.presence} aria-hidden />{status.text}</span>}
          </div>
        </section>

        <section className={styles.apanel}>
          {view === 'main' && (
            <>
              <div className={styles.apHead}>
                <h1 data-ph-mask={own ? '' : undefined}>{name}</h1>
                <p>{desc}</p>
                {runState !== 'idle' && <p role="status">{runState === 'copied' ? t(curated ? 'prefilled_open' : 'copied_open', { client: clientName }) : t('copy_failed')}</p>}
              </div>

              {own?.draft && (
                <div className="flex flex-wrap gap-2">
                  <Button disabled={!canWrite} onClick={() => void patchOwn({ action: 'add' })}><Plus className="h-4 w-4" aria-hidden />{t('add_draft')}</Button>
                </div>
              )}

              <div className={styles.instr}>
                <div className={styles.partHead}>
                  <span className={styles.partLabel}>{t('section_instructions')}</span>
                  <span className={styles.partNote}>{own ? t('instructions_own') : [t('instructions_source'), overview?.workflow.version ? t('instructions_version', { version: overview.workflow.version }) : null].filter(Boolean).join(' · ')}</span>
                </div>
                <div className={styles.instrBox}><ol data-ph-mask={own ? '' : undefined}>{steps.map((step, i) => <li key={i}>{step}</li>)}</ol></div>
                <CopyInstruction body={body.data} />
              </div>

              {curated && (
                <Row label={t('section_connections')} onAdd={() => setView('apps')} addLabel={t('apps_add')}>
                  {connections.length === 0 ? <span className={styles.muted}>{t('connections_none')}</span> : connections.map((c) => <ConnectionChip key={c.kind} connection={c} />)}
                </Row>
              )}

              <Row label={t('section_knowledge')} onAdd={canEdit ? () => setView('knowledge') : undefined} addLabel={t('knowledge_add')}>
                {knowledge.length === 0 ? <span className={styles.muted}>{t(own ? 'knowledge_own' : 'knowledge_none')}</span> : knowledge.map((k) => (
                  <KnowledgeChip key={k.id} knowledge={k} canEdit={canEdit} onRemove={() => changeKnowledge('remove', k.id)} />
                ))}
              </Row>
              {canEdit && changed && <div><Button variant="ghost" size="sm" onClick={() => void changeKnowledge('reset')}>{t('knowledge_reset')}</Button></div>}

              <Row label={t('section_company')}>
                {(agents.data?.agents[0]?.company ?? []).map((c) => <span key={c.id} className={`${styles.chip} ${styles.chipCompany}`}>{c.title}</span>)}
                {overview && overview.facts_known > 0 && <span className={`${styles.chip} ${styles.chipCompany}`}>{t('company_facts_known', { known: overview.facts_known, total: AGENTS[curated!].facts.length })}</span>}
                {(agents.data?.remembered ?? 0) > 0 && <span className={`${styles.chip} ${styles.chipCompany}`}>{t('company_remembered', { count: agents.data!.remembered })}</span>}
                {(agents.data?.documents ?? 0) > 0 && <span className={`${styles.chip} ${styles.chipCompany}`}>{t('company_documents', { count: agents.data!.documents })}</span>}
              </Row>

              {own && !own.draft && <ShareBox status={own.shareStatus ?? 'private'} canWrite={canWrite} onShare={(share) => patchOwn(share === 'withdraw' ? { action: 'withdraw' } : { action: 'submit', confirmed_no_customer_data: true, author_handle: share.author_handle })} />}
              {own && (own.shareStatus ?? 'private') === 'private' && <DeleteOwn canWrite={canWrite} onDelete={deleteOwn} />}
            </>
          )}
          {view === 'knowledge' && (
            <KnowledgePanel held={knowledge} options={options.data ?? []} onBack={() => setView('main')} onChange={changeKnowledge} />
          )}
          {view === 'apps' && curated && (
            <AppsPanel used={connections} onBack={() => setView('main')} />
          )}
        </section>
      </div>
    </div>
  )
}

function Row({ label, children, onAdd, addLabel }: { label: string; children: ReactNode; onAdd?: () => void; addLabel?: string }) {
  return (
    <div className={styles.aprow}>
      <span className={styles.l}>{label}</span>
      <div className={styles.chips}>{children}</div>
      {onAdd ? <Button variant="outline" size="icon-sm" aria-label={addLabel} onClick={onAdd}><Plus className="h-4 w-4" aria-hidden /></Button> : <span />}
    </div>
  )
}

function CopyInstruction({ body }: { body: string | undefined }) {
  const t = useTranslations('skills_registry')
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={!body} onClick={() => {
        const copying = body && navigator.clipboard ? navigator.clipboard.writeText(body) : Promise.reject(new Error('Nothing to copy'))
        void copying.then(() => setState('copied'), () => setState('failed'))
      }}>{t(state === 'copied' ? 'copied_full' : 'copy_full')}</Button>
      {state === 'failed' && <span role="alert" className={styles.muted}>{t('body_failed')}</span>}
    </div>
  )
}

function KnowledgeChip({ knowledge, canEdit, onRemove }: { knowledge: KnowledgeMeta; canEdit: boolean; onRemove: () => Promise<boolean> }) {
  const t = useTranslations('skills_registry')
  const name = useKnowledgeName()
  const describe = useKnowledgeDesc()
  const [busy, setBusy] = useState(false)
  const label = name(knowledge.id, knowledge.title)
  return (
    <span className={`${styles.chip} ${styles.chipKnow} ${knowledge.source === 'added' ? styles.chipAdded : ''}`} title={describe(knowledge.id, knowledge.summary)}>
      {label}
      {knowledge.source === 'added' && <small>{t('knowledge_added_tag')}</small>}
      {canEdit && (
        <button type="button" className={styles.chipX} aria-label={t('knowledge_remove', { name: label })} disabled={busy} onClick={() => { setBusy(true); void onRemove().finally(() => setBusy(false)) }}>
          <X className="h-3 w-3" aria-hidden />
        </button>
      )}
    </span>
  )
}

/** A connection with its brand mark: the company's bank, Skatteverket, Peppol, or what lives in the AI. */
function ConnectionMark({ kind }: { kind: AgentConnection }) {
  const { cashAccounts } = useCashAccounts({ enabledOnly: true })
  const bank = cashAccounts.map((a) => bankLogoUrl(a.bank_name, a.name)).find((url): url is string => !!url)
  /* eslint-disable @next/next/no-img-element */
  if (kind === 'skatteverket') return <img src="/logos/skatteverket_color.svg" alt="" />
  if (kind === 'mail') return <GmailMark />
  if (kind === 'bank') return bank ? <img src={bank} alt="" /> : <Landmark className="h-4 w-4" aria-hidden />
  if (kind === 'peppol') return <FileText className="h-4 w-4" aria-hidden />
  return <Globe className="h-4 w-4" aria-hidden />
  /* eslint-enable @next/next/no-img-element */
}

function ConnectionChip({ connection }: { connection: AgentConnectionState }) {
  const t = useTranslations('skills_registry')
  const inner = <><span className={styles.appchip}><ConnectionMark kind={connection.kind} /></span>{t(`conn_${connection.kind}`)}<small>{t(`conn_${connection.status}`)}</small></>
  return connection.status === 'missing' && connection.settings_href
    ? <Link href={connection.settings_href} className={styles.chip} data-status={connection.status}>{inner}</Link>
    : <span className={styles.chip} data-status={connection.status}>{inner}</span>
}

const GROUPS = ['horizontal', 'vertical', 'modifier'] as const

/** Kunskap, as in Oasis's skill picker: Accounted or community, a search, and cards to add or take away. */
function KnowledgePanel({ held, options, onBack, onChange }: {
  held: KnowledgeMeta[]
  options: KnowledgeOption[]
  onBack: () => void
  onChange: (action: KnowledgeAction, atomId?: string) => Promise<boolean>
}) {
  const t = useTranslations('skills_registry')
  const name = useKnowledgeName()
  const describe = useKnowledgeDesc()
  const [source, setSource] = useState<'accounted' | 'community'>('accounted')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const holds = new Set(held.map((k) => k.id))
  const q = query.trim().toLowerCase()
  const shown = options
    .filter((o) => (source === 'community') === (o.tier === 'community'))
    .filter((o) => !q || `${name(o.id, o.title)} ${describe(o.id, o.summary)}`.toLowerCase().includes(q))
    .sort((a, b) => GROUPS.indexOf(a.tier as typeof GROUPS[number]) - GROUPS.indexOf(b.tier as typeof GROUPS[number]))
  async function toggle(id: string) {
    setBusy(id)
    setFailed(!(await onChange(holds.has(id) ? 'remove' : 'add', id)))
    setBusy(null)
  }
  return (
    <div className="flex flex-col gap-4">
      <button type="button" className={styles.back} onClick={onBack}><ChevronLeft className="h-4 w-4" aria-hidden />{t('knowledge_picker_done')}</button>
      <div className={styles.segs} role="tablist">
        {(['accounted', 'community'] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={source === s} className={styles.seg} onClick={() => setSource(s)}>{t(s === 'accounted' ? 'tab_accounted' : 'tab_community')}</button>
        ))}
      </div>
      <label className={styles.search}>
        <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
        <input id="agent-knowledge-search" type="search" value={query} placeholder={t('knowledge_search')} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {failed && <p role="alert" className={styles.muted}>{t('knowledge_save_failed')}</p>}
      {shown.length === 0 ? <p className={styles.muted}>{t(source === 'community' ? 'knowledge_community_empty' : 'knowledge_all_added')}</p> : (
        <div className={styles.kgrid2}>
          {shown.map((o) => {
            const has = holds.has(o.id)
            return (
              <div key={o.id} className={styles.kcard} data-held={has ? '' : undefined}>
                <div className={styles.kcardTop}>
                  <b>{name(o.id, o.title)}</b>
                  <Button variant={has ? 'default' : 'outline'} size="icon-sm" loading={busy === o.id} disabled={busy !== null && busy !== o.id} aria-label={has ? t('knowledge_remove', { name: name(o.id, o.title) }) : t('knowledge_add')} onClick={() => void toggle(o.id)}>
                    {has ? <Check className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
                  </Button>
                </div>
                <p>{describe(o.id, o.summary)}</p>
                <small>{o.tier === 'community' ? t('knowledge_by_community') : `${t(`knowledge_group_${o.tier}`)} · ${t('knowledge_by')}`}</small>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const ALL_CONNECTIONS: AgentConnection[] = ['bank', 'skatteverket', 'peppol', 'mail', 'browser']

/** Kopplingar, as in Oasis's connector grid: the ones this agent uses first, then everything there is. */
function AppsPanel({ used, onBack }: { used: AgentConnectionState[]; onBack: () => void }) {
  const t = useTranslations('skills_registry')
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const states = new Map(used.map((c) => [c.kind, c]))
  const tile = (kind: AgentConnection) => {
    const state = states.get(kind)
    const content = <><span className={styles.appIcon}><ConnectionMark kind={kind} /></span>{t(`conn_${kind}`)}{state && <small>{t(`conn_${state.status}`)}</small>}{!state && !isCheckable(kind) && <small>{t('conn_in_ai')}</small>}</>
    return isCheckable(kind) && state?.status !== 'connected'
      ? <Link key={kind} href={CONNECTION_SETTINGS[kind]} className={styles.apptile} data-used={state ? '' : undefined}>{content}</Link>
      : <span key={kind} className={styles.apptile} data-used={state ? '' : undefined}>{content}</span>
  }
  const match = (kind: AgentConnection) => !q || t(`conn_${kind}`).toLowerCase().includes(q)
  return (
    <div className="flex flex-col gap-4">
      <button type="button" className={styles.back} onClick={onBack}><ChevronLeft className="h-4 w-4" aria-hidden />{t('knowledge_picker_done')}</button>
      <label className={styles.search}>
        <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
        <input id="agent-apps-search" type="search" value={query} placeholder={t('apps_search')} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {used.length > 0 && (
        <>
          <span className={styles.partLabel}>{t('apps_used')}</span>
          <div className={styles.appgrid}>{used.map((c) => c.kind).filter(match).map(tile)}</div>
        </>
      )}
      <span className={styles.partLabel}>{t('apps_all')}</span>
      <div className={styles.appgrid}>{ALL_CONNECTIONS.filter((k) => !states.has(k)).filter(match).map(tile)}</div>
      <p className={styles.muted}>{t('apps_note')}</p>
    </div>
  )
}

const HANDLE = /^[a-z0-9][a-z0-9-]{0,38}$/

/** Share an own agent with the community: it waits for Accounted's review before anyone else sees it. */
function ShareBox({ status, canWrite, onShare }: {
  status: NonNullable<SkillSummary['shareStatus']>
  canWrite: boolean
  onShare: (share: { author_handle: string } | 'withdraw') => Promise<boolean>
}) {
  const t = useTranslations('skills_registry')
  const [open, setOpen] = useState(false)
  const [handle, setHandle] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'failed'>('idle')
  async function send(share: { author_handle: string } | 'withdraw') {
    setState('sending')
    setState((await onShare(share)) ? 'idle' : 'failed')
  }
  if (status === 'submitted' || status === 'published') {
    return (
      <div className={styles.share}>
        <span className={styles.shareStatus}><span className={styles.chipDot} aria-hidden />{t(`share_status_${status}`)}</span>
        <div><Button variant="outline" size="sm" disabled={!canWrite} loading={state === 'sending'} onClick={() => void send('withdraw')}>{t('share_withdraw')}</Button></div>
        {state === 'failed' && <p role="alert">{t('share_failed')}</p>}
      </div>
    )
  }
  if (status === 'withdrawn') return <p className={styles.muted}>{t('share_status_withdrawn')}</p>
  if (!open) return <div><Button variant="outline" disabled={!canWrite} onClick={() => setOpen(true)}>{t('share_cta')}</Button></div>
  return (
    <form className={styles.share} onSubmit={(e) => { e.preventDefault(); if (HANDLE.test(handle) && confirmed) void send({ author_handle: handle }) }}>
      <p>{t('share_body')}</p>
      <label htmlFor="agent-share-handle">
        {t('share_handle')}
        <input id="agent-share-handle" type="text" value={handle} autoComplete="off" spellCheck={false} maxLength={39} onChange={(e) => setHandle(e.target.value.toLowerCase())} aria-describedby="agent-share-handle-hint" />
        <small id="agent-share-handle-hint" className={styles.partNote}>{t('share_handle_hint')}</small>
      </label>
      <label className={styles.check} htmlFor="agent-share-confirm">
        <input id="agent-share-confirm" type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        {t('share_confirm')}
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={!canWrite || !confirmed || !HANDLE.test(handle)} loading={state === 'sending'}>{t('share_submit')}</Button>
        <Button variant="outline" size="sm" onClick={() => setOpen(false)}>{t('cancel')}</Button>
      </div>
      {state === 'failed' && <p role="alert">{t('share_failed')}</p>}
    </form>
  )
}

function DeleteOwn({ canWrite, onDelete }: { canWrite: boolean; onDelete: () => Promise<boolean> }) {
  const t = useTranslations('skills_registry')
  const [confirm, setConfirm] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <div><Button variant="ghost" size="sm" disabled={!canWrite} onClick={() => setConfirm(true)}>{t('delete')}</Button></div>
      {failed && <p role="alert" className={styles.muted}>{t('save_failed')}</p>}
      <DestructiveConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('delete')}
        description={t('delete_confirm')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        onConfirm={async () => { setFailed(!(await onDelete())) }}
      />
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowRight, Loader2, Plus } from 'lucide-react'
import useSWR from 'swr'
import { useCompany } from '@/contexts/CompanyContext'
import { useCanWrite } from '@/lib/hooks/use-can-write'
import { useBranding } from '@/lib/branding/brand-context'
import { FREE_SKILLS, REGISTRY_SKILLS, skillsToDoNow, type RegistrySkillId } from '@/lib/agent-skills/registry'
import { AI_CLIENTS, aiConnectAction, aiPrefilledChatLink, openAiConnector, pickConnectedAiClient, type AiClient } from '@/lib/onboarding/ai-clients'
import { createAiStatusPoller, type AiStatusPoller } from '@/lib/onboarding/ai-status-poll'
import { formatDateLong } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { HelpPopover } from '@/components/ui/help-popover'
import { Button } from '@/components/ui/button'
import { SkillCreator, type CreatorMode } from './SkillCreator'
import { SourceMarks } from './ConnectionMark'
import { AGENTS } from '@/lib/agent-skills/agents'
import { AgentCard } from './AgentCard'
import { PackCard, railName, Section, SharedCard } from './KindViews'
import { KindsIntro } from './KindsIntro'
import { useKnowledgeName } from './knowledge-labels'
import { itemHue, placeFromParam, placeHref, type Place } from './hues'
import { agentSegment, agentStatus, communityMeta, fetchConnections, kindOf, readAgents, readCatalog, readOptions, readUsage, readWorklist, simulatedClient, type SkillSummary } from './data'
import styles from './skills.module.css'


type PageState = 'loading' | 'locked' | 'waiting' | 'open'

/**
 * Agentinstruktioner: what the company gives the AI it brings, in four kinds
 * (flows, rules, analyses, connections), each from Accounted, the community
 * or the company itself. A flow opens its own page (/skills/<id>) with its
 * instructions, knowledge and connections. `hrefBase` lets the sandbox demo
 * link to its own pages.
 */
export function SkillsPage({ hrefBase = '/skills' }: { hrefBase?: string }) {
  const { company } = useCompany()
  return company ? <Registry key={company.id} companyId={company.id} hrefBase={hrefBase} /> : null
}

function Registry({ companyId, hrefBase }: { companyId: string; hrefBase: string }) {
  const t = useTranslations('skills_registry')
  const locale = useLocale()
  const { canWrite } = useCanWrite()
  const { appName } = useBranding()
  const pageRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const pathname = usePathname()
  const placeParam = useSearchParams().get('plats')
  const setPlace = (next: Place) => router.replace(placeHref(pathname, next), { scroll: false })
  const catalog = useSWR(['/api/skills', companyId], ([url]) => readCatalog(url))
  const options = useSWR(['/api/agents/knowledge', companyId], ([url]) => readOptions(url))
  const knowledgeName = useKnowledgeName()
  const worklist = useSWR(['/api/worklist/counts', companyId], ([url]) => readWorklist(url))
  const usage = useSWR(['/api/skills/usage', companyId], ([url]) => readUsage(url))
  const doNow = skillsToDoNow(worklist.data ?? {})
  const own = (catalog.data ?? []).filter((skill): skill is SkillSummary & { installations: [{ installation_id: string }] } =>
    skill.tier === 'own' && skill.shareStatus !== 'withdrawn' && !!skill.installations[0])
  // Reviewed community agents and knowledge: published atoms of the community tier.

  // ── connection: asked on load and whenever the user comes back to the tab ──
  const [connected, setConnected] = useState<AiClient[] | null>(null)
  const [pending, setPending] = useState<AiClient | null>(null)
  const [checkedOnce, setCheckedOnce] = useState(false)
  const pollerRef = useRef<AiStatusPoller | null>(null)
  useEffect(() => {
    const simulated = simulatedClient()
    const poller = createAiStatusPoller({
      fetchStatus: simulated ? async () => [simulated] : fetchConnections,
      onStatus: setConnected,
      isHidden: () => document.visibilityState === 'hidden',
    })
    pollerRef.current = poller
    poller.check()
    const onBack = () => { if (document.visibilityState === 'visible') poller.check() }
    window.addEventListener('focus', onBack)
    document.addEventListener('visibilitychange', onBack)
    return () => {
      window.removeEventListener('focus', onBack)
      document.removeEventListener('visibilitychange', onBack)
      poller.stop()
      pollerRef.current = null
    }
  }, [])
  const isConnected = (connected?.length ?? 0) > 0
  // Once an AI is connected nothing is pending any more.
  const waitingFor = isConnected ? null : pending
  const state: PageState = connected === null ? 'loading' : isConnected ? 'open' : waitingFor ? 'waiting' : 'locked'
  const client = pickConnectedAiClient(connected ?? [], waitingFor ?? undefined) ?? waitingFor ?? 'claude'
  const clientName = AI_CLIENTS.find((c) => c.id === client)!.name
  const agents = useSWR(['/api/agents', companyId, client], ([url, , c]) => readAgents(`${url}?client=${c}`))

  // ── places: Allmänt, each industry and company form, Egna, Community ──
  // The company's own industry (stored at onboarding) leads the industry list. A cheap model can later
  // suggest more of what fits; until then this is enough.
  const companyIndustry = agents.data?.agents[0]?.company.find((c) => c.tier === 'vertical')?.id ?? null
  const packs = options.data ?? []
  const verticals = [...packs.filter((o) => o.tier === 'vertical')].sort((a, b) => Number(b.id === companyIndustry) - Number(a.id === companyIndustry))
  const modifiers = packs.filter((o) => o.tier === 'modifier')
  const horizontals = packs.filter((o) => o.tier === 'horizontal')
  const byVotes = (a: SkillSummary, b: SkillSummary) => (communityMeta(b)?.votes ?? 0) - (communityMeta(a)?.votes ?? 0)
  const shared = (catalog.data ?? []).filter((skill) => skill.tier === 'community').sort(byVotes)
  const madeFor = (skill: SkillSummary) => communityMeta(skill)?.industries ?? []
  const sharedIn = (place: Place) => shared.filter((skill) => place === 'general' ? madeFor(skill).length === 0 : madeFor(skill).includes(place))
  // An own flow saved by the AI waits under Egna to be added, so that place opens first.
  const place: Place = placeParam ? placeFromParam(placeParam) : own.some((skill) => skill.draft) ? 'own' : 'general'
  const countOf = (p: Place) => p === 'general' ? REGISTRY_SKILLS.length + horizontals.length + sharedIn('general').length
    : p === 'own' ? own.length : p === 'community' ? shared.length : 1 + sharedIn(p).length
  const placeName = (p: Place) => p === 'general' ? t('place_general') : p === 'own' ? t('tab_own') : p === 'community' ? t('tab_community')
    : railName(knowledgeName(p, packs.find((o) => o.id === p)?.title ?? p))

  // ── connect ──
  const [addressCopy, setAddressCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [creator, setCreator] = useState<CreatorMode | null>(null)
  const connectAction = (target: AiClient) => aiConnectAction(target, { origin: window.location.origin, appName })
  function connect(target: AiClient) {
    setCreator(null)
    setPending(target)
    setAddressCopy('idle')
    setCheckedOnce(false)
    // Claude has an add-connector deep link. ChatGPT and Grok get the address to paste first.
    if (target === 'claude') openAiConnector(connectAction(target).open)
    pollerRef.current?.attempt(target)
  }
  function reopen(target: AiClient) {
    openAiConnector(connectAction(target).open)
    pollerRef.current?.attempt(target)
  }
  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address)
      setAddressCopy('copied')
    } catch {
      setAddressCopy('failed')
    }
  }
  function createAgent() {
    if (!isConnected) setCreator({ kind: 'gate' })
    else openAiConnector(aiPrefilledChatLink(client, t('create_prompt')))
  }

  // A status shows once everything it depends on has loaded, so it never flashes "Redo" and then changes.
  const statusReady = state !== 'loading' && !!agents.data && !!worklist.data && !!usage.data
  const statusFor = (id: RegistrySkillId) => !statusReady ? undefined : agentStatus({
    id,
    aiKnown: state === 'locked' || state === 'waiting' ? false : state === 'open' ? true : null,
    overview: agents.data,
    waiting: doNow.get(id),
    lastAt: usage.data?.[id]?.last_at,
    t: (key, values) => t(key, values),
    formatDate: (iso) => formatDateLong(iso, locale),
  })
  const card = (id: RegistrySkillId) => (
    <AgentCard
      key={id}
      href={`${hrefBase}/${agentSegment(id)}`}
      title={t(`skills.${id}.name`)}
      desc={t(`skills.${id}.short`)}
      kind="workflow"
      symbolKey={id}
      hue={itemHue('workflow', id, id)}
      status={statusFor(id)}
      marks={<SourceMarks connections={AGENTS[id].connections} />}
    />
  )
  const top = REGISTRY_SKILLS.slice(0, FREE_SKILLS).map((s) => s.id)
  // agents with work waiting on Att göra come first
  const rest = REGISTRY_SKILLS.slice(FREE_SKILLS).map((s) => s.id)
  const ordered = [...rest.filter((id) => doNow.has(id)), ...rest.filter((id) => !doNow.has(id))]
  const flows = [...top, ...ordered]
  const rowsLocked = state === 'locked' || state === 'waiting'
  const pendingName = waitingFor ? AI_CLIENTS.find((c) => c.id === waitingFor)!.name : ''
  const address = waitingFor && waitingFor !== 'claude' ? connectAction(waitingFor).copy : null

  return (
    <div ref={pageRef} className={styles.page} data-state={state}>
      <PageHeader title={t('title')} help={<HelpPopover><p>{t('help')}</p></HelpPopover>} />

      <KindsIntro companyId={companyId} />

      <div className={styles.placeLayout}>
        <nav className={styles.rail} aria-label={t('rail_label')}>
          <RailItem label={t('place_general')} count={countOf('general')} current={place === 'general'} onClick={() => setPlace('general')} />
          {verticals.length > 0 && <span className={styles.railGroup}>{t('level_vertical')}</span>}
          {verticals.map((o) => (
            <RailItem key={o.id} label={railName(knowledgeName(o.id, o.title))} note={o.id === companyIndustry ? t('industry_yours') : undefined} count={countOf(o.id as Place)} current={place === o.id} onClick={() => setPlace(o.id as Place)} />
          ))}
          {modifiers.length > 0 && <span className={styles.railGroup}>{t('level_modifier')}</span>}
          {modifiers.map((o) => (
            <RailItem key={o.id} label={railName(knowledgeName(o.id, o.title))} count={countOf(o.id as Place)} current={place === o.id} onClick={() => setPlace(o.id as Place)} />
          ))}
          <span className={styles.railSep} aria-hidden />
          <RailItem label={t('tab_own')} count={countOf('own')} current={place === 'own'} onClick={() => setPlace('own')} />
          <RailItem label={t('tab_community')} count={countOf('community')} current={place === 'community'} onClick={() => setPlace('community')} />
        </nav>

        <div key={place} className={`${styles.placeBody} ${styles.fadeIn}`}>
          <div className={styles.placeHead}>
            <h2>{placeName(place)}</h2>
            <p>{t(place === 'general' ? 'place_general_hint' : place === 'own' ? 'place_own_hint' : place === 'community' ? 'place_community_hint' : 'place_pack_hint')}</p>
          </div>
          {!canWrite && <p className={styles.note}>{t('viewer_note')}</p>}
          {catalog.error && <p role="alert" className={styles.note}>{t('load_failed')} <button type="button" className="underline underline-offset-4" onClick={() => void catalog.mutate()}>{t('retry')}</button></p>}

          {place === 'general' && (
            <>
              <section className={styles.placeSection} aria-label={t('kind_workflow')}>
                <div className={styles.levelHead}><h3>{t('kind_workflow')}</h3><span>{flows.length + sharedIn('general').filter((s) => kindOf(s) === 'workflow').length}</span></div>
                <div className={styles.veilwrap}>
                  <ul className={styles.agrid} aria-hidden={rowsLocked || undefined}>
                    {flows.map((id) => <li key={id}>{card(id)}</li>)}
                    {sharedIn('general').filter((s) => kindOf(s) === 'workflow').map((skill) => <SharedCard key={skill.slug} skill={skill} hrefBase={hrefBase} />)}
                  </ul>
                  <div className={styles.plate} data-gone={rowsLocked ? undefined : ''}>
                    {state === 'locked' && (
                      <div className={styles.gate}>
                        <h2>{t('sign_title')}</h2>
                        <div className={styles.gateClients}>
                          {AI_CLIENTS.map((c, i) => (
                            <Button key={c.id} size="lg" variant={i === 0 ? 'default' : 'outline'} className="gap-2 pl-3.5" onClick={() => connect(c.id)}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={c.logo} alt="" width={18} height={18} className={styles.clientLogo} />
                              {i === 0 ? t('connect_client', { client: c.name }) : c.name}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}
                    {state === 'waiting' && waitingFor && (
                      <div className={styles.pin}>
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
                        <h2>{waitingFor === 'claude' ? t('wait_claude_title') : t('wait_title', { client: pendingName })}</h2>
                        {waitingFor === 'claude' ? <p>{t('wait_claude_body')}</p> : (
                          <>
                            {address && (
                              <div className={styles.addr}>
                                <code aria-label={t('server_address')}>{address}</code>
                                <Button size="sm" onClick={() => void copyAddress(address)}>{t(addressCopy === 'copied' ? 'copied' : 'copy')}</Button>
                              </div>
                            )}
                            {addressCopy === 'failed' && <p role="status">{t('copy_failed')}</p>}
                            <ol className={styles.stepsl}>
                              <li>{t('step_1')}</li>
                              <li>{t('step_2', { client: pendingName })}</li>
                              <li>{t('step_3')}</li>
                            </ol>
                          </>
                        )}
                        <div className={styles.btns}>
                          <Button variant="outline" onClick={() => reopen(waitingFor)}>{t('open_client', { client: pendingName })}</Button>
                          <Button onClick={() => { setCheckedOnce(true); pollerRef.current?.check() }}>{t('check_again')}</Button>
                        </div>
                        {checkedOnce && <p role="status">{t('still_waiting', { client: pendingName })}</p>}
                        <button type="button" className="text-xs text-muted-foreground underline underline-offset-4" onClick={() => setPending(null)}>{t('cancel')}</button>
                      </div>
                    )}
                  </div>
                </div>
              </section>
              <Section kind="rules" count={horizontals.length + sharedIn('general').filter((s) => kindOf(s) === 'rules').length}>
                {horizontals.map((o) => <PackCard key={o.id} option={o} hrefBase={hrefBase} overview={agents.data} />)}
                {sharedIn('general').filter((s) => kindOf(s) === 'rules').map((skill) => <SharedCard key={skill.slug} skill={skill} hrefBase={hrefBase} />)}
              </Section>
              <Section kind="analysis" count={sharedIn('general').filter((s) => kindOf(s) === 'analysis').length}>
                {sharedIn('general').filter((s) => kindOf(s) === 'analysis').map((skill) => <SharedCard key={skill.slug} skill={skill} hrefBase={hrefBase} />)}
              </Section>
            </>
          )}

          {(place.startsWith('vertical/') || place.startsWith('modifier/')) && (
            <>
              {(['workflow', 'rules', 'analysis'] as const).map((k) => {
                const items = sharedIn(place).filter((s) => kindOf(s) === k)
                const pack = k === 'rules' ? packs.find((o) => o.id === place) : undefined
                return (
                  <Section key={k} kind={k} count={items.length + (pack ? 1 : 0)} empty={t('place_share_first', { place: placeName(place) })}>
                    {pack && <PackCard option={pack} hrefBase={hrefBase} overview={agents.data} />}
                    {items.map((skill) => <SharedCard key={skill.slug} skill={skill} hrefBase={hrefBase} />)}
                  </Section>
                )
              })}
            </>
          )}

          {place === 'own' && (
            <section className={styles.placeSection} aria-label={t('tab_own')}>
              <ul className={styles.agrid}>
                {own.map((skill) => (
                  <li key={skill.slug}>
                    <AgentCard
                      href={`${hrefBase}/${agentSegment(skill.slug)}`}
                      title={skill.name}
                      desc={skill.summary}
                      kind="workflow"
                      symbolKey={skill.slug}
                      hue={itemHue('workflow', skill.slug)}
                      masked
                      badge={skill.draft ? <span className={`${styles.now} ${styles.nowLight}`}>{t('draft_tag')}</span> : undefined}
                    />
                  </li>
                ))}
                <li>
                  <button type="button" className={`${styles.acard} ${styles.acCreate}`} disabled={!canWrite} onClick={createAgent}>
                    <span className={styles.acPanel}>
                      <span className={styles.acText}>
                        <span className={styles.acTitle}>{t('create_card_title')}</span>
                        <span className={styles.acDesc}>{t('create_card_body', { client: clientName })}</span>
                        <span className={styles.acMarks}><span className={styles.createCta}>{t('create_card_cta', { client: clientName })}<ArrowRight className="h-3.5 w-3.5" aria-hidden /></span></span>
                      </span>
                      <span className={styles.acTile}><span className={styles.createPlus} aria-hidden><Plus className="h-4 w-4" /></span></span>
                    </span>
                    <span className={styles.acFoot}><span className={styles.statusSlot} /><span className={styles.open} aria-hidden>{t('open_hint')}</span></span>
                  </button>
                </li>
              </ul>
            </section>
          )}

          {place === 'community' && (['workflow', 'rules', 'analysis'] as const).map((k) => (
            <Section key={k} kind={k} count={shared.filter((s) => kindOf(s) === k).length} empty={t(`community_empty_${k}`)}>
              {shared.filter((s) => kindOf(s) === k).map((skill) => <SharedCard key={skill.slug} skill={skill} hrefBase={hrefBase} />)}
            </Section>
          ))}
        </div>
      </div>

      <SkillCreator
        mode={creator}
        client={client}
        pageRef={pageRef}
        onClose={() => setCreator(null)}
        onConnect={connect}
        onSave={async () => null}
        onSaved={() => { setCreator(null); void catalog.mutate() }}
      />
    </div>
  )
}

function RailItem({ label, note, count, current, onClick }: { label: string; note?: string; count: number; current: boolean; onClick: () => void }) {
  return (
    <button type="button" className={styles.railItem} aria-current={current ? 'page' : undefined} onClick={onClick}>
      <span className={styles.railLabel}>{label}{note && <small>{note}</small>}</span>
      <span className={styles.railCount}>{count}</span>
    </button>
  )
}

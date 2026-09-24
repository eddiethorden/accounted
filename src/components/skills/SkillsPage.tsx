'use client'

import { useEffect, useRef, useState } from 'react'
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
import { SlidingTabs } from './SlidingTabs'
import { agentSegment, agentStatus, fetchConnections, readAgents, readCatalog, readUsage, readWorklist, simulatedClient, type SkillSummary } from './data'
import styles from './skills.module.css'

type Tab = 'accounted' | 'own' | 'community'
type PageState = 'loading' | 'locked' | 'waiting' | 'open'

/**
 * Agenter: the company's agents as cards, as in Oasis. A card opens the
 * agent's own page (/skills/<id>), where its instructions, knowledge and
 * connections live. `hrefBase` lets the sandbox demo link to its own pages.
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
  const catalog = useSWR(['/api/skills', companyId], ([url]) => readCatalog(url))
  const worklist = useSWR(['/api/worklist/counts', companyId], ([url]) => readWorklist(url))
  const usage = useSWR(['/api/skills/usage', companyId], ([url]) => readUsage(url))
  const doNow = skillsToDoNow(worklist.data ?? {})
  const own = (catalog.data ?? []).filter((skill): skill is SkillSummary & { installations: [{ installation_id: string }] } =>
    skill.tier === 'own' && skill.shareStatus !== 'withdrawn' && !!skill.installations[0])
  // Reviewed community agents and knowledge: published atoms of the community tier.
  const community = (catalog.data ?? []).filter((skill) => skill.tier === 'community')

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
  const [chosenTab, setTab] = useState<Tab | null>(null)
  // An own agent saved by the AI waits in its tab to be added, so that tab opens first.
  const tab: Tab = chosenTab ?? (own.some((skill) => skill.draft) ? 'own' : 'accounted')

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
      title={t(`skills.${id}.agent`)}
      desc={t(`skills.${id}.short`)}
      sphereKey={id}
      status={statusFor(id)}
      curated={id}
      marks={<SourceMarks connections={AGENTS[id].connections} />}
    />
  )
  const top = REGISTRY_SKILLS.slice(0, FREE_SKILLS).map((s) => s.id)
  // agents with work waiting on Att göra come first
  const rest = REGISTRY_SKILLS.slice(FREE_SKILLS).map((s) => s.id)
  const ordered = [...rest.filter((id) => doNow.has(id)), ...rest.filter((id) => !doNow.has(id))]
  const rowsLocked = state === 'locked' || state === 'waiting'
  const pendingName = waitingFor ? AI_CLIENTS.find((c) => c.id === waitingFor)!.name : ''
  const address = waitingFor && waitingFor !== 'claude' ? connectAction(waitingFor).copy : null

  return (
    <div ref={pageRef} className={styles.page} data-state={state}>
      <PageHeader title={t('title')} help={<HelpPopover><p>{t('help')}</p></HelpPopover>} />

      <section className={styles.hero}>
        <div className={styles.intro}><h2>{t('hero_title')}</h2></div>
        <ul className={styles.agrid}>
          {top.map((id) => <li key={id}>{card(id)}</li>)}
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

      <section className={styles.lower} aria-label={t('title')}>
        {!canWrite && <p className={styles.note}>{t('viewer_note')}</p>}
        {catalog.error && <p role="alert" className={styles.note}>{t('load_failed')} <button type="button" className="underline underline-offset-4" onClick={() => void catalog.mutate()}>{t('retry')}</button></p>}
        <SlidingTabs
          label={t('title')}
          value={tab}
          onChange={setTab}
          ids={{ prefix: 'agents-tab', controls: 'agents-panel' }}
          options={(['accounted', 'own', 'community'] as const).map((key) => ({
            value: key,
            label: <>{t(`tab_${key}`)}{key === 'own' && own.length > 0 && <span className={styles.tabCount}>{own.length}</span>}{key === 'community' && community.length > 0 && <span className={styles.tabCount}>{community.length}</span>}</>,
          }))}
        />

        <div key={tab} className={`${styles.veilwrap} ${styles.fadeIn}`} id="agents-panel" role="tabpanel" aria-labelledby={`agents-tab-${tab}`}>
          {tab === 'accounted' && (
            <ul className={styles.agrid} aria-hidden={rowsLocked || undefined}>
              {ordered.map((id) => <li key={id}>{card(id)}</li>)}
            </ul>
          )}
          {tab === 'own' && (own.length === 0 ? (
            <div className={styles.empty}>
              <p>{t('own_empty', { client: clientName })}</p>
              <Button disabled={!canWrite} onClick={createAgent}>{t('create_card_cta', { client: clientName })}</Button>
            </div>
          ) : (
            <ul className={styles.agrid}>
              {own.map((skill) => (
                <li key={skill.slug}>
                  <AgentCard
                    href={`${hrefBase}/${agentSegment(skill.slug)}`}
                    title={skill.name}
                    desc={skill.summary}
                    sphereKey={skill.slug}
                    masked
                    badge={skill.draft ? <span className={`${styles.now} ${styles.nowLight}`}>{t('draft_tag')}</span> : undefined}
                  />
                </li>
              ))}
            </ul>
          ))}
          {tab === 'community' && (community.length === 0 ? (
            <div className={styles.empty}>
              <h3>{t('community_empty_title')}</h3>
              <p>{t('community_empty_body')}</p>
              <Button variant="outline" onClick={() => setTab('own')}>{t('community_share_cta')}</Button>
            </div>
          ) : (
            <ul className={styles.agrid}>
              {community.map((skill) => (
                <li key={skill.slug}><AgentCard href={`${hrefBase}/${agentSegment(skill.slug)}`} title={skill.name} desc={skill.summary} sphereKey={skill.slug} /></li>
              ))}
            </ul>
          ))}

          {tab === 'accounted' && (
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
          )}
        </div>
      </section>

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

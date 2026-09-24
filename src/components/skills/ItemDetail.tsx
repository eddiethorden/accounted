'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import useSWR from 'swr'
import { ArrowLeft, Check, ChevronUp, Plus, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useCompany } from '@/contexts/CompanyContext'
import { useCanWrite } from '@/lib/hooks/use-can-write'
import { AGENTS } from '@/lib/agent-skills/agents'
import { REGISTRY_SKILLS, type RegistrySkillId } from '@/lib/agent-skills/registry'
import type { KnowledgeOption } from '@/lib/agent-skills/knowledge-choices'
import { formatDateLong } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Field, Row, SubView } from './AgentDetail'
import { FlowOrb } from './FlowOrb'
import { ItemSymbol } from './ItemSymbol'
import { StrataField } from './StrataField'
import { itemHue, kindHref, seedOf, type ItemKind } from './hues'
import { useKnowledgeDesc, useKnowledgeName } from './knowledge-labels'
import { communityMeta, communitySegment, kindOf, readAgents, readCatalog, readOptions, rulesSegment, type CommunityMeta } from './data'
import styles from './skills.module.css'

type Item = {
  kind: ItemKind
  key: string
  name: string
  desc: string
  body: string
  /** A rule pack's registry id: such an item can be given to a flow. */
  atomId: string | null
  version: number | null
  reviewedAt: string | null
  level: string | null
  community: CommunityMeta | null
}

/**
 * The page of an agent instruction that is not a flow: a rule pack from
 * Accounted, or anything the community shared. Same stage and panel as a
 * flow's page. Rules can be given to flows from here; community items carry
 * who shared them, votes and "fungerar / fungerar inte", which is what makes
 * sharing worth it.
 */
export function ItemDetail({ segment, backHref }: { segment: string; backHref: string }) {
  const { company } = useCompany()
  return company ? <Detail key={`${company.id}:${segment}`} companyId={company.id} segment={segment} backHref={backHref} /> : null
}

function Detail({ companyId, segment, backHref }: { companyId: string; segment: string; backHref: string }) {
  const t = useTranslations('skills_registry')
  const locale = useLocale()
  const { canWrite } = useCanWrite()
  const knowledgeName = useKnowledgeName()
  const knowledgeDesc = useKnowledgeDesc()
  const isRules = segment.startsWith('kunskap.')
  const options = useSWR(['/api/agents/knowledge', companyId], ([url]) => readOptions(url))
  const catalog = useSWR(isRules ? null : ['/api/skills', companyId], ([url]) => readCatalog(url))
  const agents = useSWR(['/api/agents', companyId, 'claude'], ([url, , c]) => readAgents(`${url}?client=${c}`))
  const [view, setView] = useState<'main' | 'give'>('main')

  const pack: KnowledgeOption | undefined = options.data?.find((o) => rulesSegment(o.id) === segment)
  const shared = catalog.data?.find((s) => s.tier === 'community' && communitySegment(s.slug) === segment)
  const item: Item | null = pack ? {
    kind: 'rules', key: pack.id, name: knowledgeName(pack.id, pack.title), desc: knowledgeDesc(pack.id, pack.summary), body: pack.summary,
    atomId: pack.id, version: pack.version, reviewedAt: pack.reviewed_at, level: pack.tier === 'community' ? null : pack.tier, community: null,
  } : shared ? {
    kind: kindOf(shared), key: shared.slug, name: shared.name, desc: shared.summary, body: shared.summary,
    atomId: kindOf(shared) === 'rules' && options.data?.some((o) => o.id === shared.slug) ? shared.slug : null,
    version: shared.version ?? null, reviewedAt: communityMeta(shared)?.reviewed_at ?? shared.reviewedAt ?? null, level: null, community: communityMeta(shared),
  } : null

  const loaded = isRules ? !!options.data : !!catalog.data
  if (!item) {
    return (
      <div className={styles.apage}>
        <PageHeader title={t('title')} />
        <Link href={backHref} className={styles.back}><ArrowLeft className="h-4 w-4" aria-hidden />{t('back_to_agents')}</Link>
        {loaded && <p className={styles.muted}>{t('not_found')}</p>}
      </div>
    )
  }

  const hue = itemHue(item.kind, item.key)
  const back = kindHref(backHref, item.kind)
  const flowsWith = (atomId: string) => REGISTRY_SKILLS.filter((s) => agents.data?.agents.find((a) => a.id === s.id)?.knowledge.some((k) => k.id === atomId))
  const holders = item.atomId ? flowsWith(item.atomId) : []
  const reviewed = item.reviewedAt ? formatDateLong(item.reviewedAt, locale) : null

  async function toggle(flow: RegistrySkillId, has: boolean): Promise<void> {
    if (!item?.atomId) return
    const response = await fetch('/api/agents/knowledge', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: has ? 'remove' : 'add', agent_id: flow, atom_id: item.atomId }) })
    if (response.ok) await agents.mutate()
  }

  return (
    <div className={styles.apage}>
      <PageHeader title={t('title')} />
      <Link href={back} className={styles.back}><ArrowLeft className="h-4 w-4" aria-hidden />{t('back_to_agents')}</Link>
      <div className={styles.agrid2}>
        <section className={styles.stage} aria-label={item.name}>
          <StrataField seed={seedOf(item.key)} ground={`hsl(${hue} 52% 88%)`} bar={`hsl(${hue} 40% 42%)`} strength={2.2} />
          <div className={styles.stageTile}>
            <ItemSymbol kind={item.kind} hue={hue} seedKey={item.key} size={104} open />
            <b data-ph-mask={item.community ? '' : undefined}>{item.name}</b>
            <small>{t(`kind_one_${item.kind}`)}{item.community ? ` · @${item.community.author}` : ''}</small>
          </div>
          <div className={styles.stageFoot}>
            {item.atomId
              ? <Button size="lg" className="gap-2" disabled={!canWrite} onClick={() => setView('give')}><Plus className="h-4 w-4" aria-hidden />{t('give_to_flow')}</Button>
              : <span />}
            {item.community && <Vote meta={item.community} slug={item.key} />}
          </div>
        </section>

        <section className={styles.apanel}>
          <div key={view} className={styles.viewIn}>
            {view === 'main' && (
              <>
                <div className={styles.apAvatar}><ItemSymbol kind={item.kind} hue={hue} seedKey={item.key} size={60} /></div>
                <Field label={t('field_name')}>
                  <div className={styles.fieldBox} data-ph-mask={item.community ? '' : undefined}>{item.name}</div>
                  <span className={styles.fieldHint}>{item.desc}</span>
                </Field>
                {item.body && item.body !== item.desc && <Field label={t('field_contents')}>
                  <div className={styles.instrBox}><p data-ph-mask={item.community ? '' : undefined}>{item.body}</p></div>
                </Field>}
                <div className={styles.rows}>
                  <Row label={t('row_source')}><span className={styles.muted}>{[item.community ? t('source_community') : t('source_accounted'), item.version ? t('version_short', { version: item.version }) : null].filter(Boolean).join(' · ')}</span></Row>
                  {item.level && <Row label={t('row_level')}><span className={styles.muted}>{t(`level_${item.level}`)}</span></Row>}
                  {item.community && <Row label={t('row_shared_by')}><Link href={`${backHref}/av.${item.community.author}`} className={styles.authorLink}>@{item.community.author}{item.community.author_verified && ` · ${t('author_verified')}`} · {t('author_shared', { count: item.community.author_shared })}</Link></Row>}
                  <Row label={t('row_reviewed')}><span className={styles.muted}>{reviewed ?? t('reviewed_accounted')}</span></Row>
                  {item.atomId && (
                    <Row label={t('row_used_by')} onAdd={canWrite ? () => setView('give') : undefined} addLabel={t('give_to_flow')}>
                      {holders.length === 0 ? <span className={styles.muted}>{t('used_by_none')}</span> : (
                        <>{holders.slice(0, 2).map((s) => <span key={s.id} className={styles.chip}>{t(`skills.${s.id}.name`)}</span>)}{holders.length > 2 && <span className={styles.chip}>+{holders.length - 2}</span>}</>
                      )}
                    </Row>
                  )}
                  {item.community && <Works meta={item.community} slug={item.key} />}
                </div>
              </>
            )}
            {view === 'give' && item.atomId && (
              <SubView title={t('give_to_flow')} onBack={() => setView('main')}>
                <p className={styles.muted}>{t('give_hint')}</p>
                <ul className={styles.kgrid2}>
                  {REGISTRY_SKILLS.map((s) => {
                    const has = holders.some((h) => h.id === s.id)
                    const isDefault = AGENTS[s.id].knowledge.includes(item.atomId!)
                    return (
                      <li key={s.id}>
                        <GiveCard name={t(`skills.${s.id}.name`)} task={t(`skills.${s.id}.short`)} hue={itemHue('workflow', s.id, s.id)} has={has} note={isDefault ? t('knowledge_default') : undefined} disabled={!canWrite || !agents.data} onToggle={() => toggle(s.id, has)} />
                      </li>
                    )
                  })}
                </ul>
              </SubView>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function GiveCard({ name, task, hue, has, note, disabled, onToggle }: { name: string; task: string; hue: number; has: boolean; note?: string; disabled: boolean; onToggle: () => Promise<void> }) {
  const t = useTranslations('skills_registry')
  const [busy, setBusy] = useState(false)
  return (
    <div className={styles.giveCard} data-held={has ? "" : undefined}>
      <FlowOrb hue={hue} seedKey={name} size={34} />
      <span className={styles.giveText}><b>{name}</b><span>{note ? `${task} · ${note}` : task}</span></span>
      <Button variant={has ? 'default' : 'outline'} size="icon" className={styles.sqBtn} aria-pressed={has} aria-label={has ? t('knowledge_remove', { name }) : t('give_to_named', { name })} disabled={disabled} loading={busy}
        onClick={() => { setBusy(true); void onToggle().finally(() => setBusy(false)) }}>
        {has ? <Check className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
      </Button>
    </div>
  )
}

async function sendFeedback(payload: { slug: string; vote?: boolean; feedback?: 'works' | 'not_works' | null }): Promise<boolean> {
  try {
    const response = await fetch('/api/agents/community/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    return response.ok
  } catch {
    return false
  }
}

/** The upvote on the stage: one per company member, shown at once and undone if the save fails. */
function Vote({ meta, slug }: { meta: CommunityMeta; slug: string }) {
  const t = useTranslations('skills_registry')
  const [voted, setVoted] = useState(meta.voted)
  const votes = meta.votes - (meta.voted ? 1 : 0) + (voted ? 1 : 0)
  return (
    <Button variant="outline" size="lg" className={`gap-2 ${styles.voteBtn}`} aria-pressed={voted} onClick={() => {
      const next = !voted
      setVoted(next)
      void sendFeedback({ slug, vote: next }).then((ok) => { if (!ok) setVoted(!next) })
    }}>
      <ChevronUp className="h-4 w-4" aria-hidden />{t(voted ? 'voted' : 'vote')}<span className={styles.voteCount}>{votes}</span>
    </Button>
  )
}

/** "Fungerar det?": the answer that tells the next company whether to trust it, and the author that it helped. */
function Works({ meta, slug }: { meta: CommunityMeta; slug: string }) {
  const t = useTranslations('skills_registry')
  const [mine, setMine] = useState(meta.feedback)
  const works = meta.works - (meta.feedback === 'works' ? 1 : 0) + (mine === 'works' ? 1 : 0)
  const notWorks = meta.not_works - (meta.feedback === 'not_works' ? 1 : 0) + (mine === 'not_works' ? 1 : 0)
  function choose(answer: 'works' | 'not_works') {
    const next = mine === answer ? null : answer
    const before = mine
    setMine(next)
    void sendFeedback({ slug, feedback: next }).then((ok) => { if (!ok) setMine(before) })
  }
  return (
    <Row label={t('row_works')}>
      <span className={styles.worksPair}>
        <Button variant={mine === 'works' ? 'default' : 'outline'} size="sm" className="gap-1.5" aria-pressed={mine === 'works'} onClick={() => choose('works')}><ThumbsUp className="h-3.5 w-3.5" aria-hidden />{t('works')} <span className={styles.voteCount}>{works}</span></Button>
        <Button variant={mine === 'not_works' ? 'default' : 'outline'} size="sm" className="gap-1.5" aria-pressed={mine === 'not_works'} onClick={() => choose('not_works')}><ThumbsDown className="h-3.5 w-3.5" aria-hidden />{t('not_works')} <span className={styles.voteCount}>{notWorks}</span></Button>
      </span>
    </Row>
  )
}

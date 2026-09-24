'use client'

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronUp } from 'lucide-react'
import { CONNECTION_SETTINGS, isCheckable, type AgentConnection } from '@/lib/agent-skills/agents'
import type { AgentsOverview } from '@/lib/agent-skills/agent-bundle'
import type { KnowledgeOption } from '@/lib/agent-skills/knowledge-choices'
import { AgentCard } from './AgentCard'
import { ConnectionMark } from './ConnectionMark'
import { SlidingTabs } from './SlidingTabs'
import { itemHue, type ItemKind } from './hues'
import { useKnowledgeDesc, useKnowledgeName } from './knowledge-labels'
import { communityMeta, communitySegment, kindOf, rulesSegment, type CommunityMeta, type SkillSummary } from './data'
import styles from './skills.module.css'

type Source = 'accounted' | 'community' | 'own' | 'ai'

const SOURCES: Record<Exclude<ItemKind, 'workflow'>, Source[]> = {
  rules: ['accounted', 'community', 'own'],
  analysis: ['accounted', 'community', 'own'],
  connection: ['accounted', 'community', 'ai'],
}
const LEVELS = ['horizontal', 'modifier', 'vertical'] as const
const ACCOUNTED_CONNECTIONS: AgentConnection[] = ['bank', 'skatteverket', 'peppol']
const AI_CONNECTIONS: AgentConnection[] = ['mail', 'browser']

/**
 * Regler, Analyser and Kopplingar: the same page as the flows, with the same
 * three sources in tabs. Regler are the reviewed packs (grouped general to
 * specific), Kopplingar are Accounted's own, the community's recipes, and
 * what lives in the user's AI.
 */
export function KindView({ kind, hrefBase, catalog, options, overview, clientName, remembered }: {
  kind: Exclude<ItemKind, 'workflow'>
  hrefBase: string
  catalog: SkillSummary[]
  options: KnowledgeOption[]
  overview: AgentsOverview | null | undefined
  clientName: string
  remembered: number
}) {
  const t = useTranslations('skills_registry')
  const knowledgeName = useKnowledgeName()
  const knowledgeDesc = useKnowledgeDesc()
  const [source, setSource] = useState<Source>('accounted')
  // Most voted first: what others found useful is what a newcomer should see.
  const community = catalog.filter((s) => s.tier === 'community' && kindOf(s) === kind)
    .sort((a, b) => (communityMeta(b)?.votes ?? 0) - (communityMeta(a)?.votes ?? 0))
  const usedBy = (atomId: string) => overview?.agents.filter((a) => a.knowledge.some((k) => k.id === atomId)).length ?? 0
  const connectionState = (kindName: AgentConnection) => overview?.agents.flatMap((a) => a.connections).find((c) => c.kind === kindName)?.status

  const count = (s: Source) => s === 'community' ? community.length : 0
  const packs = options.filter((o) => o.tier !== 'community')

  return (
    <section className={styles.lower} aria-label={t(`kind_${kind}`)}>
      <SlidingTabs
        label={t(`kind_${kind}`)}
        value={source}
        onChange={setSource}
        ids={{ prefix: `${kind}-tab`, controls: `${kind}-panel` }}
        options={SOURCES[kind].map((key) => ({
          value: key,
          label: <>{key === 'ai' ? t('tab_ai', { client: clientName }) : t(`tab_${key}`)}{count(key) > 0 && <span className={styles.tabCount}>{count(key)}</span>}</>,
        }))}
      />
      <div key={source} className={`${styles.kindPanel} ${styles.fadeIn}`} id={`${kind}-panel`} role="tabpanel" aria-labelledby={`${kind}-tab-${source}`}>
        {source === 'community' && (community.length === 0
          ? <Empty title={t('community_empty_title')} body={t(`community_empty_${kind}`)} />
          : <ul className={styles.agrid}>{community.map((skill) => (
            <li key={skill.slug}>
              <AgentCard href={`${hrefBase}/${communitySegment(skill.slug)}`} title={skill.name} desc={skill.summary} hue={itemHue(kind, skill.slug)} foot={<CommunityFoot meta={communityMeta(skill)} />} />
            </li>
          ))}</ul>)}

        {kind === 'rules' && source === 'accounted' && LEVELS.map((level) => {
          const items = packs.filter((o) => o.tier === level)
          if (items.length === 0) return null
          return (
            <div key={level} className={styles.level}>
              <div className={styles.levelHead}><h3>{t(`level_${level}`)}</h3><span>{t(`level_${level}_hint`)}</span></div>
              <ul className={styles.agrid}>{items.map((o) => (
                <li key={o.id}>
                  <AgentCard
                    href={`${hrefBase}/${rulesSegment(o.id)}`}
                    title={knowledgeName(o.id, o.title)}
                    desc={knowledgeDesc(o.id, o.summary)}
                    hue={itemHue('rules', o.id)}
                    foot={<span className={styles.metaLine}>{[o.version ? t('version_short', { version: o.version }) : null, usedBy(o.id) > 0 ? t('used_by', { count: usedBy(o.id) }) : null].filter(Boolean).join(' · ')}</span>}
                  />
                </li>
              ))}</ul>
            </div>
          )
        })}
        {kind === 'rules' && source === 'own' && <Empty title={t('rules_own_title')} body={remembered > 0 ? t('rules_own_body_count', { count: remembered }) : t('rules_own_body')} />}

        {kind === 'analysis' && source === 'accounted' && <Empty title={t('analysis_accounted_title')} body={t('analysis_accounted_body')} />}
        {kind === 'analysis' && source === 'own' && <Empty title={t('analysis_own_title')} body={t('analysis_own_body', { client: clientName })} />}

        {kind === 'connection' && source === 'accounted' && (
          <ul className={styles.agrid}>{ACCOUNTED_CONNECTIONS.map((c) => {
            const state = connectionState(c)
            return (
              <li key={c}>
                <AgentCard
                  href={CONNECTION_SETTINGS[c as keyof typeof CONNECTION_SETTINGS]}
                  title={t(`conn_${c}`)}
                  desc={t(`conn_desc_${c}`)}
                  hue={itemHue('connection', c)}
                  marks={<span className={styles.mark}><ConnectionMark kind={c} /></span>}
                  foot={state && isCheckable(c) ? <span className={styles.status} data-presence={state === 'connected' ? 'ready' : 'blocked'}>{t(state === 'connected' ? 'conn_state_connected' : 'conn_state_missing')}</span> : undefined}
                />
              </li>
            )
          })}</ul>
        )}
        {kind === 'connection' && source === 'ai' && (
          <>
            <p className={styles.note}>{t('conn_ai_note', { client: clientName })}</p>
            <ul className={styles.agrid}>{AI_CONNECTIONS.map((c) => (
              <li key={c}>
                <AgentCard
                  title={t(`conn_${c}`)}
                  desc={t(`conn_desc_${c}`)}
                  hue={itemHue('connection', c)}
                  marks={<span className={styles.mark}><ConnectionMark kind={c} /></span>}
                  foot={<span className={styles.metaLine}>{t('conn_ai_unseen', { client: clientName })}</span>}
                />
              </li>
            ))}</ul>
          </>
        )}
      </div>
    </section>
  )
}

function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  )
}

/** Who shared it and what others think, on the card's foot. */
export function CommunityFoot({ meta }: { meta: CommunityMeta | null }) {
  const t = useTranslations('skills_registry')
  if (!meta) return null
  const rated = meta.works + meta.not_works
  return (
    <span className={styles.metaLine}>
      <span>@{meta.author}</span>
      <span className={styles.voteMini} aria-label={t('votes_label', { count: meta.votes })}><ChevronUp className="h-3.5 w-3.5" aria-hidden />{meta.votes}</span>
      {rated > 0 && <span>{t('works_share', { pct: Math.round((meta.works / rated) * 100) })}</span>}
    </span>
  )
}

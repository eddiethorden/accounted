'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronUp } from 'lucide-react'
import type { AgentsOverview } from '@/lib/agent-skills/agent-bundle'
import type { KnowledgeOption } from '@/lib/agent-skills/knowledge-choices'
import { AgentCard } from './AgentCard'
import { itemHue, type ItemKind } from './hues'
import { useKnowledgeDesc, useKnowledgeName } from './knowledge-labels'
import { communityMeta, communitySegment, kindOf, rulesSegment, type CommunityMeta, type SkillSummary } from './data'
import styles from './skills.module.css'

/** A rail entry's name without the SNI or other trailing parenthesis, so the list stays one short line each. */
export function railName(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/, '')
}

/** One of a place's three parts: arbetsflöden, kunskap or analyser, with a count and an invitation when empty. */
export function Section({ kind, count, children, empty }: { kind: ItemKind; count: number; children: ReactNode; empty?: ReactNode }) {
  const t = useTranslations('skills_registry')
  return (
    <section className={styles.placeSection} aria-label={t(`kind_${kind}`)}>
      <div className={styles.levelHead}><h3>{t(`kind_${kind}`)}</h3><span>{count}</span></div>
      {count === 0 ? <p className={styles.placeEmpty}>{empty ?? t('place_empty')}</p> : <ul className={styles.agrid}>{children}</ul>}
    </section>
  )
}

/** A knowledge pack as a card, with how many flows carry it. */
export function PackCard({ option, hrefBase, overview }: { option: KnowledgeOption; hrefBase: string; overview: AgentsOverview | null | undefined }) {
  const t = useTranslations('skills_registry')
  const knowledgeName = useKnowledgeName()
  const knowledgeDesc = useKnowledgeDesc()
  const usedBy = overview?.agents.filter((a) => a.knowledge.some((k) => k.id === option.id)).length ?? 0
  return (
    <li>
      <AgentCard
        href={`${hrefBase}/${rulesSegment(option.id)}`}
        title={knowledgeName(option.id, option.title)}
        desc={knowledgeDesc(option.id, option.summary)}
        kind="rules"
        symbolKey={option.id}
        hue={itemHue('rules', option.id)}
        foot={<span className={styles.metaLine}>{[option.version ? t('version_short', { version: option.version }) : null, usedBy > 0 ? t('used_by', { count: usedBy }) : null].filter(Boolean).join(' · ')}</span>}
      />
    </li>
  )
}

/** A shared item as a card, with its author and rating. */
export function SharedCard({ skill, hrefBase }: { skill: SkillSummary; hrefBase: string }) {
  const kind = kindOf(skill)
  return (
    <li>
      <AgentCard href={`${hrefBase}/${communitySegment(skill.slug)}`} title={skill.name} desc={skill.summary} kind={kind} symbolKey={skill.slug} hue={itemHue(kind, skill.slug)} foot={<CommunityFoot meta={communityMeta(skill)} />} />
    </li>
  )
}

/** Who shared it and what others think, on the card's foot. */
export function CommunityFoot({ meta }: { meta: CommunityMeta | null }) {
  const t = useTranslations('skills_registry')
  if (!meta) return null
  const rated = meta.works + meta.not_works
  return (
    <span className={styles.metaLine}>
      <span>@{meta.author}{meta.author_verified && <span className={styles.verified} title={t('author_verified')}>✓</span>}</span>
      <span className={styles.voteMini} aria-label={t('votes_label', { count: meta.votes })}><ChevronUp className="h-3.5 w-3.5" aria-hidden />{meta.votes}</span>
      {rated > 0 && <span>{t('works_share', { pct: Math.round((meta.works / rated) * 100) })}</span>}
      {meta.used_by !== null && meta.used_by > 0 && <span>{t('used_by_companies', { count: meta.used_by })}</span>}
    </span>
  )
}

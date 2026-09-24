'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AgentOverview, AgentsOverview, KnowledgeMeta } from '@/lib/agent-skills/agent-bundle'
import type { KnowledgeAction, KnowledgeOption } from '@/lib/agent-skills/knowledge-choices'
import { AGENTS } from '@/lib/agent-skills/agents'
import { formatDateLong } from '@/lib/utils'
import styles from './skills.module.css'

/** The pack slug behind a knowledge id: "horizontal/swedish-vat" -> "swedish-vat". */
function packSlug(id: string): string {
  return id.split('/')[1] ?? id
}

/** A pack's one-line description for people; the registry's own is written for agent routing. */
export function useKnowledgeDesc() {
  const t = useTranslations('skills_registry')
  return (id: string, fallback: string) => {
    const key = `knowledge_descs.${packSlug(id)}`
    return t.has(key) ? t(key) : fallback
  }
}

/** A knowledge pack's display name, falling back to its registry title. */
export function useKnowledgeName() {
  const t = useTranslations('skills_registry')
  return (id: string, title: string) => {
    const key = `knowledge_names.${packSlug(id)}`
    return t.has(key) ? t(key) : title
  }
}

/**
 * An agent as its four parts: how it works (Instruktioner), the Swedish rules
 * it carries (Kunskap), what it knows about this company (Företaget) and where
 * it acts (Kopplingar). Own agents have no declared knowledge or connections:
 * their AI loads the rules on demand.
 */
/** What the company part counts: the agent's own view of the company, from GET /api/agents. */
export type CompanyCounts = Pick<AgentsOverview, 'agreements' | 'remembered' | 'documents'>

/** Changing an agent's knowledge; resolves false when the change could not be saved. */
export type ChangeKnowledge = (action: KnowledgeAction, atomId?: string) => Promise<boolean>

export function AgentParts({ steps, agent, knowledge, company, counts, own, options, canEdit, onChangeKnowledge }: {
  steps: string[]
  agent?: AgentOverview
  /** What this agent knows for the company: the curated agent's effective list, or an own agent's choices. */
  knowledge: KnowledgeMeta[]
  company: AgentOverview['company']
  counts: CompanyCounts
  own: boolean
  options: KnowledgeOption[]
  canEdit: boolean
  onChangeKnowledge: ChangeKnowledge
}) {
  const t = useTranslations('skills_registry')
  const locale = useLocale()
  const knowledgeName = useKnowledgeName()

  return (
    <div className={styles.parts}>
      <section className={styles.part} aria-labelledby="agent-part-instructions">
        <div className={styles.partHead}>
          <h3 id="agent-part-instructions" className={styles.partLabel}>{t('section_instructions')}</h3>
          <span className={styles.partNote}>
            {own ? t('instructions_own') : [t('instructions_source'), agent?.workflow.version ? t('instructions_version', { version: agent.workflow.version }) : null].filter(Boolean).join(' · ')}
          </span>
        </div>
        {steps.length > 0 && <ol className={styles.steps}>{steps.map((step, i) => <li key={i} data-ph-mask={own ? '' : undefined}>{step}</li>)}</ol>}
      </section>

      <KnowledgePart
        knowledge={knowledge}
        references={agent?.references ?? []}
        changed={knowledge.some((k) => k.source === 'added') || (agent?.removed.length ?? 0) > 0}
        own={own}
        options={options}
        canEdit={canEdit}
        onChange={onChangeKnowledge}
        name={knowledgeName}
        versionLabel={(k) => k.reviewed_at
          ? t('knowledge_reviewed', { date: formatDateLong(k.reviewed_at, locale) })
          : k.version ? t('instructions_version', { version: k.version }) : null}
      />

      <section className={styles.part} aria-labelledby="agent-part-company">
        <div className={styles.partHead}>
          <h3 id="agent-part-company" className={styles.partLabel}>{t('section_company')}</h3>
          {!own && <span className={styles.partNote}>{t('company_given')}</span>}
        </div>
        {(() => {
          const def = agent ? AGENTS[agent.id] : null
          const chips = [
            ...company.map((c) => ({ key: c.id, text: c.title })),
            ...(def && agent && agent.facts_known > 0 ? [{ key: 'facts', text: t('company_facts_known', { known: agent.facts_known, total: def.facts.length }) }] : []),
            ...(def?.agreements && counts.agreements > 0 ? [{ key: 'agreements', text: t('company_agreements', { count: counts.agreements }) }] : []),
            ...(counts.remembered > 0 ? [{ key: 'remembered', text: t('company_remembered', { count: counts.remembered }) }] : []),
            ...(counts.documents > 0 ? [{ key: 'documents', text: t('company_documents', { count: counts.documents }) }] : []),
          ]
          return chips.length === 0 ? <p className={styles.muted}>{t('company_none')}</p> : (
            <ul className={styles.chips}>
              {chips.map((c) => <li key={c.key} className={`${styles.chip} ${styles.chipCompany}`}>{c.text}</li>)}
            </ul>
          )
        })()}
      </section>

      {!own && agent && (
        <section className={styles.part} aria-labelledby="agent-part-connections">
          <h3 id="agent-part-connections" className={styles.partLabel}>{t('section_connections')}</h3>
          {agent.connections.length === 0 ? <p className={styles.muted}>{t('connections_none')}</p> : (
            <ul className={styles.chips}>
              {agent.connections.map((c) => {
                const label = <><span className={styles.chipDot} aria-hidden />{t(`conn_${c.kind}`)}<small>{t(`conn_${c.status}`)}</small></>
                return (
                  <li key={c.kind} className="contents">
                    {c.status === 'missing' && c.settings_href
                      ? <Link href={c.settings_href} className={styles.chip} data-status={c.status}>{label}</Link>
                      : <span className={styles.chip} data-status={c.status}>{label}</span>}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

const GROUPS = ['horizontal', 'vertical', 'modifier', 'community'] as const

/** Kunskap: what the agent knows, and the company's say in it. */
function KnowledgePart({ knowledge, references, changed, own, options, canEdit, onChange, name, versionLabel }: {
  knowledge: KnowledgeMeta[]
  references: AgentOverview['references']
  changed: boolean
  own: boolean
  options: KnowledgeOption[]
  canEdit: boolean
  onChange: ChangeKnowledge
  name: (id: string, title: string) => string
  versionLabel: (k: KnowledgeMeta) => string | null
}) {
  const t = useTranslations('skills_registry')
  const describe = useKnowledgeDesc()
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const held = new Set(knowledge.map((k) => k.id))
  const available = options.filter((o) => !held.has(o.id))

  async function change(action: KnowledgeAction, atomId?: string) {
    setBusy(atomId ?? action)
    setFailed(!(await onChange(action, atomId)))
    setBusy(null)
  }

  return (
    <section className={styles.part} aria-labelledby="agent-part-knowledge">
      <div className={styles.partHead}>
        <h3 id="agent-part-knowledge" className={styles.partLabel}>{t('section_knowledge')}</h3>
        {canEdit && <span className={styles.partNote}>{t('knowledge_hint')}</span>}
      </div>
      {knowledge.length === 0
        ? <p className={styles.muted}>{t(own ? 'knowledge_own' : 'knowledge_none')}</p>
        : (
          <ul className={styles.chips}>
            {knowledge.map((k) => {
              const label = name(k.id, k.title)
              const version = versionLabel(k)
              return (
                <li key={k.id} className={`${styles.chip} ${styles.chipKnow} ${k.source === 'added' ? styles.chipAdded : ''}`} title={describe(k.id, k.summary)}>
                  {label}
                  {k.source === 'added' ? <small>{t('knowledge_added_tag')}</small> : version ? <small>{version}</small> : null}
                  {canEdit && (
                    <button type="button" className={styles.chipX} aria-label={t('knowledge_remove', { name: label })} disabled={busy !== null} onClick={() => void change('remove', k.id)}>
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      {references.length > 0 && (
        <details className={styles.refs}>
          <summary>{t('knowledge_refs', { count: references.length })}</summary>
          <ul>{references.map((r) => <li key={r.id}>{r.title}</li>)}</ul>
        </details>
      )}
      {canEdit && (
        <div className={styles.partActions}>
          <Button variant="outline" size="sm" className="gap-1.5" aria-expanded={picking} onClick={() => setPicking((open) => !open)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />{t('knowledge_add')}
          </Button>
          {changed && <Button variant="ghost" size="sm" loading={busy === 'reset'} onClick={() => void change('reset')}>{t('knowledge_reset')}</Button>}
        </div>
      )}
      {failed && <p role="alert" className={styles.muted}>{t('knowledge_save_failed')}</p>}
      {canEdit && picking && (
        <div className={styles.picker}>
          {available.length === 0 ? <p className={styles.muted}>{t('knowledge_all_added')}</p> : GROUPS.map((group) => {
            const items = available.filter((o) => o.tier === group)
            if (items.length === 0) return null
            return (
              <div key={group} className={styles.pickGroup}>
                <span className={styles.partLabel}>{t(`knowledge_group_${group}`)}</span>
                {items.map((o) => (
                  <div key={o.id} className={styles.pickItem}>
                    <span className={styles.pickText}><b>{name(o.id, o.title)}</b><span>{describe(o.id, o.summary)}</span></span>
                    <Button variant="outline" size="sm" loading={busy === o.id} disabled={busy !== null && busy !== o.id} onClick={() => void change('add', o.id)}>{t('knowledge_add_one')}</Button>
                  </div>
                ))}
              </div>
            )
          })}
          <div><Button variant="ghost" size="sm" onClick={() => setPicking(false)}>{t('knowledge_picker_done')}</Button></div>
        </div>
      )}
    </section>
  )
}

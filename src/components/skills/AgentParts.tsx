'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import type { AgentOverview } from '@/lib/agent-skills/agent-bundle'
import { formatDateLong } from '@/lib/utils'
import styles from './skills.module.css'

/** The pack slug behind a knowledge id: "horizontal/swedish-vat" -> "swedish-vat". */
function packSlug(id: string): string {
  return id.split('/')[1] ?? id
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
export function AgentParts({ steps, agent, company, facts, own }: {
  steps: string[]
  agent?: AgentOverview
  company: AgentOverview['company']
  facts: number
  own: boolean
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

      <section className={styles.part} aria-labelledby="agent-part-knowledge">
        <h3 id="agent-part-knowledge" className={styles.partLabel}>{t('section_knowledge')}</h3>
        {own ? <p className={styles.muted}>{t('knowledge_own')}</p> : !agent ? null : agent.knowledge.length === 0 ? <p className={styles.muted}>{t('knowledge_none')}</p> : (
          <>
            <ul className={styles.chips}>
              {agent.knowledge.map((k) => (
                <li key={k.id} className={`${styles.chip} ${styles.chipKnow}`} title={k.summary}>
                  {knowledgeName(k.id, k.title)}
                  {k.reviewed_at
                    ? <small>{t('knowledge_reviewed', { date: formatDateLong(k.reviewed_at, locale) })}</small>
                    : k.version ? <small>{t('instructions_version', { version: k.version })}</small> : null}
                </li>
              ))}
            </ul>
            {agent.references.length > 0 && (
              <details className={styles.refs}>
                <summary>{t('knowledge_refs', { count: agent.references.length })}</summary>
                <ul>{agent.references.map((r) => <li key={r.id}>{r.title}</li>)}</ul>
              </details>
            )}
          </>
        )}
      </section>

      <section className={styles.part} aria-labelledby="agent-part-company">
        <h3 id="agent-part-company" className={styles.partLabel}>{t('section_company')}</h3>
        {company.length === 0 && facts === 0 ? <p className={styles.muted}>{t('company_none')}</p> : (
          <ul className={styles.chips}>
            {company.map((c) => <li key={c.id} className={`${styles.chip} ${styles.chipCompany}`}>{c.title}</li>)}
            {facts > 0 && <li className={`${styles.chip} ${styles.chipCompany}`}>{t('company_facts', { count: facts })}</li>}
          </ul>
        )}
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

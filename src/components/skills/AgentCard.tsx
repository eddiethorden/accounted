'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { AgentSphere, type Presence } from './AgentSphere'
import { seedOf } from './AgentArt'
import styles from './skills.module.css'

/**
 * One agent in the list: a tinted panel with the name, what it does and the
 * apps it uses, the agent's sphere on a white tile, and a foot with
 * how it is doing right now.
 */
export function AgentCard({ href, title, desc, sphereKey, status, marks, badge, masked }: {
  href: string
  title: string
  desc: string
  /** Seeds the agent's sphere, so each agent turns its own way. */
  sphereKey: string
  status?: { presence: Presence; text: string }
  marks?: ReactNode
  badge?: ReactNode
  /** Company-written text: masked in session replay. */
  masked?: boolean
}) {
  const t = useTranslations('skills_registry')
  return (
    <Link href={href} className={styles.acard}>
      <span className={styles.acPanel}>
        <span className={styles.acText}>
          <span className={styles.acTitle} data-ph-mask={masked ? '' : undefined}>{title}{badge}</span>
          <span className={styles.acDesc} data-ph-mask={masked ? '' : undefined}>{desc}</span>
          {marks && <span className={styles.acMarks}>{marks}</span>}
        </span>
        <span className={styles.acTile}><AgentSphere size={64} presence={status?.presence ?? 'ready'} seed={seedOf(sphereKey) % 100} /></span>
      </span>
      <span className={styles.acFoot}>
        <span className={styles.statusSlot}>{status && <span className={`${styles.status} ${styles.fadeIn}`} data-presence={status.presence}>{status.text}</span>}</span>
        <span className={styles.open} aria-hidden>{t('open_hint')}</span>
      </span>
    </Link>
  )
}

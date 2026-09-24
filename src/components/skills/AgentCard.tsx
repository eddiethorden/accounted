'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { AgentOrb, type Presence } from './AgentOrb'
import styles from './skills.module.css'

/**
 * One agent in the list, as in Oasis: a tinted panel with the name, what it
 * does and the apps it uses, the agent's orb on a white tile, and a foot with
 * how it is doing right now.
 */
export function AgentCard({ href, title, desc, hues, status, marks, badge, masked }: {
  href: string
  title: string
  desc: string
  hues: readonly [number, number, number]
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
        <span className={styles.acTile}><AgentOrb hues={hues} presence={status?.presence} size="card" /></span>
      </span>
      <span className={styles.acFoot}>
        {status && <span className={styles.status} data-presence={status.presence}>{status.text}</span>}
        <span className={styles.open} aria-hidden>{t('open_hint')}</span>
      </span>
    </Link>
  )
}

'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import type { Presence } from './hues'
import { Folder } from './Folder'
import styles from './skills.module.css'

/**
 * One agent instruction in the list: a tinted panel with the name, what it
 * does and what it uses, its folder on a white tile (it opens on hover), and
 * a foot with a status or, for community items, who shared it and how it is
 * rated. Without `href` the card is not a link (a connection that lives in
 * the user's AI has no page).
 */
export function AgentCard({ href, title, desc, hue, status, marks, badge, foot, masked }: {
  href?: string
  title: string
  desc: string
  hue: number
  status?: { presence: Presence; text: string }
  marks?: ReactNode
  badge?: ReactNode
  /** Replaces the status line, e.g. a community item's author and rating. */
  foot?: ReactNode
  /** Company-written text: masked in session replay. */
  masked?: boolean
}) {
  const t = useTranslations('skills_registry')
  const inner = (
    <>
      <span className={styles.acPanel}>
        <span className={styles.acText}>
          <span className={styles.acTitle} data-ph-mask={masked ? '' : undefined}>{title}{badge}</span>
          <span className={styles.acDesc} data-ph-mask={masked ? '' : undefined}>{desc}</span>
          {marks && <span className={styles.acMarks}>{marks}</span>}
        </span>
        <span className={styles.acTile}><Folder hue={hue} size={66} /></span>
      </span>
      <span className={styles.acFoot}>
        <span className={styles.statusSlot}>{foot ?? (status && <span className={`${styles.status} ${styles.fadeIn}`} data-presence={status.presence}>{status.text}</span>)}</span>
        {href && <span className={styles.open} aria-hidden>{t('open_hint')}</span>}
      </span>
    </>
  )
  return href ? <Link href={href} className={styles.acard}>{inner}</Link> : <div className={`${styles.acard} ${styles.acardStatic}`}>{inner}</div>
}

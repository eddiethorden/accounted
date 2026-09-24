'use client'

import { useTranslations } from 'next-intl'
import { AGENTS } from '@/lib/agent-skills/agents'
import type { RegistrySkillId } from '@/lib/agent-skills/registry'
import styles from './skills.module.css'

/** How an agent is doing right now: ready, has work waiting, blocked on a connection, or waiting for the user's AI. */
export type Presence = 'ready' | 'busy' | 'blocked' | 'idle'

/** The agent's face with a presence dot. Faces are CC0 Notionists, self-hosted (see agents.ts). */
export function AgentAvatar({ id, presence, size = 'md' }: { id: RegistrySkillId; presence?: Presence; size?: 'md' | 'lg' }) {
  return (
    <span className={styles.avatar} data-size={size}>
      {/* A small static self-hosted SVG: next/image adds nothing here. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={AGENTS[id].persona.avatar} alt="" />
      {presence && <span className={styles.presence} data-presence={presence} aria-hidden />}
    </span>
  )
}

/** Name over role, the way a colleague is introduced: "Mona" / "Moms". */
export function AgentWho({ id }: { id: RegistrySkillId }) {
  const t = useTranslations('skills_registry')
  return (
    <span className={styles.who}>
      <span className={styles.whoName}>{AGENTS[id].persona.name}</span>
      <span className={styles.whoRole}>{t(`skills.${id}.role`)}</span>
    </span>
  )
}

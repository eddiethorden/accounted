'use client'

import type { CSSProperties } from 'react'
import styles from './skills.module.css'

/** How an agent is doing right now: ready, has work waiting, blocked on a connection, or waiting for the user's AI. */
export type Presence = 'ready' | 'busy' | 'blocked' | 'idle'

/** An own agent has no chosen colours: three hues from its id, stable across visits. */
export function huesFor(key: string): readonly [number, number, number] {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360
  return [h, (h + 40) % 360, (h + 130) % 360]
}

/** The agent's face: an orb of three hues, with a presence dot. */
export function AgentOrb({ hues, presence, size = 'md' }: { hues: readonly [number, number, number]; presence?: Presence; size?: 'sm' | 'md' | 'card' | 'lg' }) {
  const style = { '--h1': hues[0], '--h2': hues[1], '--h3': hues[2] } as CSSProperties
  return (
    <span className={styles.orbWrap} data-size={size}>
      <span className={styles.orb} style={style} aria-hidden />
      {presence && <span className={styles.presence} data-presence={presence} aria-hidden />}
    </span>
  )
}

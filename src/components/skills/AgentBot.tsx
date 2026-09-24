'use client'

import { BotAvatar } from 'bot-avatars'
import type { RegistrySkillId } from '@/lib/agent-skills/registry'
import { seedOf, type Presence } from './AgentSphere'
import styles from './skills.module.css'

type BotType = 'clover' | 'flower' | 'triangle' | 'square' | 'blob' | 'ghost' | 'circle' | 'drop' | 'star' | 'droid' | 'mech' | 'alien' | 'hexagon' | 'cat' | 'cloud' | 'pill' | 'pebble' | 'puddle'

/** Each agent its own bot: the shape carries its colour (bot-avatars, MIT). */
const BOTS: Record<RegistrySkillId, BotType> = {
  bookkeep: 'clover',
  kvittojakten: 'cat',
  'reconcile-month': 'hexagon',
  'month-end-close': 'square',
  'quarterly-vat-review': 'triangle',
  'payroll-monthly': 'flower',
  'invoicing-rules': 'pill',
  'kreditfaktura-process': 'drop',
  'year-end-close': 'star',
  'tax-planning': 'droid',
}
/** The company's own agents pick from the softer shapes, stable per agent. */
const OWN_BOTS: BotType[] = ['blob', 'pebble', 'cloud', 'circle', 'puddle', 'ghost']

/** Work waiting makes the bot work; no AI connected puts it to sleep. */
function botState(presence: Presence | undefined): 'default' | 'working' | 'sleeping' {
  return presence === 'busy' ? 'working' : presence === 'idle' ? 'sleeping' : 'default'
}

export function AgentBot({ agentKey, curated, presence, size = 64 }: { agentKey: string; curated?: RegistrySkillId | null; presence?: Presence; size?: number }) {
  const seed = seedOf(agentKey)
  const type = curated ? BOTS[curated] : OWN_BOTS[seed % OWN_BOTS.length]
  return (
    <span className={styles.bot} style={{ width: size, height: size }}>
      <BotAvatar type={type} state={botState(presence)} size={size} seed={(seed % 100) / 100} />
      {presence && <span className={styles.presence} data-presence={presence} aria-hidden />}
    </span>
  )
}

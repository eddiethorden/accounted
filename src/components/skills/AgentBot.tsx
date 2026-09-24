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
/**
 * Each agent's hue: its bot's body and its stage share it, so the page reads
 * as one colour (as in Oasis). Own agents get a hue from their id.
 */
export const AGENT_HUES: Record<RegistrySkillId, number> = {
  bookkeep: 210,
  kvittojakten: 24,
  'reconcile-month': 4,
  'month-end-close': 196,
  'quarterly-vat-review': 278,
  'payroll-monthly': 142,
  'invoicing-rules': 250,
  'kreditfaktura-process': 174,
  'year-end-close': 44,
  'tax-planning': 330,
}
export function agentHue(agentKey: string, curated?: RegistrySkillId | null): number {
  return curated ? AGENT_HUES[curated] : seedOf(agentKey) % 360
}

/** The company's own agents pick from the softer shapes, stable per agent. */
const OWN_BOTS: BotType[] = ['blob', 'pebble', 'cloud', 'circle', 'puddle', 'ghost']

/** No AI connected puts the bot to sleep; otherwise it looks around. It never hops on its own (founder: "stop jumping"). */
function botState(presence: Presence | undefined): 'default' | 'sleeping' {
  return presence === 'idle' ? 'sleeping' : 'default'
}

export function AgentBot({ agentKey, curated, presence, size = 64 }: { agentKey: string; curated?: RegistrySkillId | null; presence?: Presence; size?: number }) {
  const seed = seedOf(agentKey)
  const type = curated ? BOTS[curated] : OWN_BOTS[seed % OWN_BOTS.length]
  return (
    <span className={styles.bot} style={{ width: size, height: size }}>
      <BotAvatar type={type} state={botState(presence)} size={size} seed={(seed % 100) / 100} color={`hsl(${agentHue(agentKey, curated)} 68% 60%)`} jumpEvery={0} />
    </span>
  )
}

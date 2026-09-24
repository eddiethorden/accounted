'use client'

import { AgentDetail } from './AgentDetail'
import { ItemDetail } from './ItemDetail'

/** One agent instruction's page: a flow (curated or own), or a rule pack or community item. */
export function InstructionDetail({ segment, backHref = '/skills' }: { segment: string; backHref?: string }) {
  const decoded = decodeURIComponent(segment)
  return decoded.startsWith('regler.') || decoded.startsWith('community.')
    ? <ItemDetail segment={decoded} backHref={backHref} />
    : <AgentDetail segment={decoded} backHref={backHref} />
}

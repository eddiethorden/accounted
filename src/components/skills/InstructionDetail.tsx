'use client'

import { AgentDetail } from './AgentDetail'
import { ItemDetail } from './ItemDetail'
import { CreatorProfile } from './CreatorProfile'

/** One agent instruction's page (a flow, a knowledge pack or a community item), or a community author's page (av.<handle>). */
export function InstructionDetail({ segment, backHref = '/skills' }: { segment: string; backHref?: string }) {
  const decoded = decodeURIComponent(segment)
  if (decoded.startsWith('av.')) return <CreatorProfile handle={decoded.slice(3)} backHref={backHref} />
  return decoded.startsWith('kunskap.') || decoded.startsWith('community.') || decoded.startsWith('egen.')
    ? <ItemDetail segment={decoded} backHref={backHref} />
    : <AgentDetail segment={decoded} backHref={backHref} />
}

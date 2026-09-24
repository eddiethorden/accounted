import { notFound } from 'next/navigation'
import { getDashboardCompanyId } from '../../request-context'
import { isAgentsPageEnabled } from '@/lib/agent-skills/flag'
import { AgentDetail } from '@/components/skills/AgentDetail'

/** /skills/[id]: one agent's page (a curated agent id, or own-<uuid>). Hidden in production with /skills. */
export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const companyId = await getDashboardCompanyId()
  if (!isAgentsPageEnabled(companyId)) notFound()
  const { id } = await params
  return <AgentDetail segment={id} />
}

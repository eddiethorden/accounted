import { AgentDetail } from '@/components/skills/AgentDetail'

/** /skills/[id]: one agent's page (a curated agent id, or own-<uuid> for the company's own). */
export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <AgentDetail segment={id} />
}

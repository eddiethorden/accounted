import { notFound } from 'next/navigation'
import { getDashboardCompanyId } from '../request-context'
import { isAgentsPageEnabled } from '@/lib/agent-skills/flag'
import { SkillsPage } from '@/components/skills/SkillsPage'

/** /skills: the Agenter page, hidden in production while it is finished. */
export default async function Page() {
  const companyId = await getDashboardCompanyId()
  if (!isAgentsPageEnabled(companyId)) notFound()
  return <SkillsPage />
}

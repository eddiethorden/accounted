import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getDashboardCompanyId } from '../../request-context'
import { isArkivSectionEnabled } from '@/lib/arkiv/flag'
import { PageHeader } from '@/components/ui/page-header'
import { HelpPopover } from '@/components/ui/help-popover'
import { ArkivConnections } from '@/components/arkiv/ArkivConnections'

/** /arkiv/kopplingar: the company, its counterparties and the documents that bind them, as the shelf knows them. */
export default async function ArkivConnectionsPage() {
  const companyId = await getDashboardCompanyId()
  if (!companyId || !isArkivSectionEnabled(companyId)) notFound()
  const t = await getTranslations('arkiv')
  return (
    <div className="space-y-6">
      <PageHeader title={t('connections_title')} help={<HelpPopover>{t('connections_help')}</HelpPopover>} />
      <ArkivConnections />
    </div>
  )
}

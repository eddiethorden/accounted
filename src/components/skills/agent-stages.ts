import type { RegistrySkillId } from '@/lib/agent-skills/registry'

// The plain ground behind each agent: the start cards' strata grounds
// (components/dashboard/startkort-assets.ts), with faint strata bars drawn
// over them by StrataField. No pictures: the founder found them cluttered.
export const AGENT_GROUNDS: Record<RegistrySkillId, string> = {
  bookkeep: '#1F2B20',
  kvittojakten: '#3A2118',
  'reconcile-month': '#1B2136',
  'month-end-close': '#16303B',
  'quarterly-vat-review': '#2E3C58',
  'payroll-monthly': '#322416',
  'invoicing-rules': '#2A2233',
  'kreditfaktura-process': '#1B2136',
  'year-end-close': '#322416',
  'tax-planning': '#1F2B20',
}

/** The company's own agents share the Stockholm petrol. */
export const OWN_GROUND = '#16303B'

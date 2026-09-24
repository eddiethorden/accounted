import type { RegistrySkillId } from '@/lib/agent-skills/registry'

/** The areas of the books an item helps with, as in the filter row. */
export const AREAS = ['lopande', 'moms', 'lon', 'fakturering', 'bokslut', 'analys'] as const
export type Area = typeof AREAS[number]

/** Where each curated flow belongs. */
export const FLOW_AREAS: Record<RegistrySkillId, Area> = {
  bookkeep: 'lopande',
  kvittojakten: 'lopande',
  'reconcile-month': 'lopande',
  'month-end-close': 'lopande',
  'quarterly-vat-review': 'moms',
  'payroll-monthly': 'lon',
  'invoicing-rules': 'fakturering',
  'kreditfaktura-process': 'fakturering',
  'year-end-close': 'bokslut',
  'tax-planning': 'bokslut',
}

/** Where each general knowledge pack belongs, by its slug. Industry and company-form packs have no area. */
const PACK_AREAS: Record<string, Area> = {
  'swedish-accounting-compliance': 'lopande',
  'swedish-daily-bookkeeping': 'lopande',
  'swedish-sie-import-export': 'lopande',
  'swedish-project-accounting': 'lopande',
  'swedish-cash-register': 'lopande',
  'swedish-vat': 'moms',
  'swedish-invoice-compliance': 'fakturering',
  'swedish-e-invoicing': 'fakturering',
  'swedish-payroll': 'lon',
  'swedish-asset-accounting': 'bokslut',
  'swedish-financial-reporting': 'bokslut',
  'swedish-year-end-closing': 'bokslut',
  'swedish-tax-planning': 'bokslut',
  'swedish-ef-skatteplanering': 'bokslut',
  'swedish-sru-filing': 'bokslut',
  'swedish-inventory': 'bokslut',
}
export function packArea(atomId: string): Area | null {
  return PACK_AREAS[atomId.split('/')[1] ?? ''] ?? null
}

/** What the filter row narrows by. `industry` is a vertical pack id, or 'all'. */
export interface Filters {
  q: string
  area: Area | 'all'
  industry: string
  uses: string[]
}
export const NO_FILTERS: Filters = { q: '', area: 'all', industry: 'all', uses: [] }

/** What an item offers the filter row. `industries: []` means it fits every industry. */
export interface Facets {
  title: string
  desc: string
  area: Area | null
  industries: readonly string[]
  uses: readonly string[]
}

export function matches(filters: Filters, item: Facets): boolean {
  const q = filters.q.trim().toLocaleLowerCase('sv')
  if (q && !`${item.title} ${item.desc}`.toLocaleLowerCase('sv').includes(q)) return false
  if (filters.area !== 'all' && item.area !== filters.area) return false
  if (filters.industry !== 'all' && item.industries.length > 0 && !item.industries.includes(filters.industry)) return false
  if (filters.uses.length > 0 && !item.uses.some((u) => filters.uses.includes(u))) return false
  return true
}

/** Made for the chosen industry: shown first and marked on the card. */
export function forIndustry(filters: Filters, item: Facets): boolean {
  return filters.industry !== 'all' && item.industries.includes(filters.industry)
}

/** Narrowing beyond the industry, which is always set to the company's own. */
export function narrowed(filters: Filters): boolean {
  return filters.q.trim() !== '' || filters.area !== 'all' || filters.uses.length > 0
}

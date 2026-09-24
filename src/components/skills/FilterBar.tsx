'use client'

import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { ToolbarSearch } from '@/components/ui/toolbar-search'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ContextPicker } from '@/components/common/ContextPicker'
import type { AgentConnection } from '@/lib/agent-skills/agents'
import { ConnectionMark } from './ConnectionMark'
import { AREAS, NO_FILTERS, narrowed, type Area, type Filters } from './filters'
import styles from './skills.module.css'

const MARKED: readonly string[] = ['bank', 'skatteverket', 'peppol', 'mail', 'browser']

/**
 * The filter row, as in a template gallery: search, the area of the books,
 * the industry (the company's own by default) and, as "Vad använder ni?",
 * what an item works with.
 */
export function FilterBar({ filters, onChange, industries, companyIndustry, showArea, uses }: {
  filters: Filters
  onChange: (next: Filters) => void
  industries: Array<{ id: string; label: string }>
  companyIndustry: string | null
  showArea: boolean
  uses: string[]
}) {
  const t = useTranslations('skills_registry')
  const industryLabel = filters.industry === 'all' ? t('industry_all') : industries.find((i) => i.id === filters.industry)?.label ?? t('industry_all')
  const toggleUse = (u: string) => onChange({ ...filters, uses: filters.uses.includes(u) ? filters.uses.filter((x) => x !== u) : [...filters.uses, u] })
  return (
    <div className={styles.filters}>
      <div className={styles.filterRow}>
        <ToolbarSearch
          aria-label={t('search_label')}
          placeholder={t('search_placeholder')}
          value={filters.q}
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
        />
        {showArea && (
          <SegmentedControl<Area | 'all'>
            aria-label={t('area_label')}
            value={filters.area}
            onChange={(area) => onChange({ ...filters, area })}
            options={[{ value: 'all', label: t('area_all') }, ...AREAS.map((a) => ({ value: a, label: t(`area_${a}`) }))]}
          />
        )}
        <ContextPicker
          className={styles.filterEnd}
          ariaLabel={t('industry_label')}
          triggerLabel={industryLabel}
          value={filters.industry}
          onChange={(industry) => onChange({ ...filters, industry })}
          items={[
            { id: 'all', label: t('industry_all') },
            ...industries.map((i) => ({ id: i.id, label: i.label, annotation: i.id === companyIndustry ? t('industry_yours') : undefined })),
          ]}
        />
      </div>
      {uses.length > 0 && (
        <div className={styles.filterRow} role="group" aria-label={t('uses_label')}>
          <span className={styles.filterLabel}>{t('uses_label')}</span>
          {uses.map((u) => (
            <button key={u} type="button" className={styles.useChip} aria-pressed={filters.uses.includes(u)} onClick={() => toggleUse(u)}>
              {MARKED.includes(u) && <span className={styles.useMark}><ConnectionMark kind={u as AgentConnection} /></span>}
              {MARKED.includes(u) ? t(`conn_${u}`) : u.charAt(0).toUpperCase() + u.slice(1)}
            </button>
          ))}
          {narrowed(filters) && (
            <button type="button" className={styles.clearFilters} onClick={() => onChange({ ...NO_FILTERS, industry: filters.industry })}>
              <X className="h-3.5 w-3.5" aria-hidden />{t('filters_clear')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

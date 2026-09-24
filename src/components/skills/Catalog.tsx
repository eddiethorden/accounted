'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ArrowLeft, ArrowRight, ArrowUpDown, Briefcase, Building2, ChevronDown, ChevronUp, Cloud, HardHat, Laptop, Megaphone, Plus, Shuffle, SlidersHorizontal, ShoppingCart, Stethoscope, UserRound, UtensilsCrossed, type LucideIcon } from 'lucide-react'
import type { AgentsOverview } from '@/lib/agent-skills/agent-bundle'
import type { KnowledgeOption } from '@/lib/agent-skills/knowledge-choices'
import { REGISTRY_SKILLS } from '@/lib/agent-skills/registry'
import type { SkillUsage } from '@/lib/agent-skills/usage'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ToolbarSearch } from '@/components/ui/toolbar-search'
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ItemSymbol } from './ItemSymbol'
import { itemHue, type ItemKind } from './hues'
import { useKnowledgeDesc, useKnowledgeName } from './knowledge-labels'
import { agentSegment, communityMeta, communitySegment, kindOf, rulesSegment, type CommunityMeta, type SkillSummary } from './data'
import styles from './skills.module.css'

const KINDS: ItemKind[] = ['workflow', 'rules', 'analysis']
const KIND_PARAM: Record<ItemKind, string> = { workflow: 'arbetsfloden', rules: 'kunskap', analysis: 'analyser' }
const TOP = 6
const CATEGORIES_SHOWN = 6

/** A category's picture, by the industry or company-form pack it stands for. */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  'bygg-hantverk': HardHat,
  'e-handel': ShoppingCart,
  'konsult-it': Laptop,
  'reklambyra-marknadsforing': Megaphone,
  'restaurang-cafe': UtensilsCrossed,
  'vard-halsa': Stethoscope,
  'software-saas-ai': Cloud,
  'holding-ab': Building2,
  'mixed-verksamhet': Shuffle,
  'single-shareholder-ab-fmb': UserRound,
}

type Source = 'accounted' | 'community' | 'own'
interface Item {
  key: string
  kind: ItemKind
  title: string
  desc: string
  href: string
  source: Source
  meta: CommunityMeta | null
  /** The industry and company-form packs it belongs to; none means it fits everyone. */
  categories: string[]
  popularity: number
  usedByFlows?: number
}

/**
 * Agentinstruktioner as a catalogue, laid out like Claude's Customize page:
 * the three kinds as tabs, Egna | Upptäck, search, a category filter and sort
 * in one toolbar. Upptäck opens on a featured item, the most used and the
 * categories (industries and company forms) with counts; a category or a
 * search shows the full list. Egna is what the company made or uses.
 */
export function Catalog({ hrefBase, catalog, options, overview, usage, own, companyIndustry, clientName, canWrite, onCreate, gate }: {
  hrefBase: string
  catalog: SkillSummary[]
  options: KnowledgeOption[]
  overview: AgentsOverview | null | undefined
  usage: SkillUsage | undefined
  own: SkillSummary[]
  companyIndustry: string | null
  clientName: string
  canWrite: boolean
  onCreate: () => void
  /** Shown in the featured slot while no AI is connected. */
  gate: ReactNode
}) {
  const t = useTranslations('skills_registry')
  const knowledgeName = useKnowledgeName()
  const knowledgeDesc = useKnowledgeDesc()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const kind = KINDS.find((k) => KIND_PARAM[k] === params.get('typ')) ?? 'workflow'
  const view: 'discover' | 'own' = params.get('vy') === 'egna' ? 'own' : 'discover'
  const category = params.get('kategori')?.replace('.', '/') ?? null
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'popular' | 'name'>('popular')
  const [showAll, setShowAll] = useState(false)
  const [allCategories, setAllCategories] = useState(false)

  function go(next: { typ?: ItemKind; vy?: 'discover' | 'own'; kategori?: string | null }) {
    const sp = new URLSearchParams(params.toString())
    const typ = next.typ ?? kind
    if (typ === 'workflow') sp.delete('typ'); else sp.set('typ', KIND_PARAM[typ])
    const vy = next.vy ?? view
    if (vy === 'own') sp.set('vy', 'egna'); else sp.delete('vy')
    const kat = next.kategori === undefined ? category : next.kategori
    if (kat) sp.set('kategori', kat.replace('/', '.')); else sp.delete('kategori')
    setShowAll(false)
    router.replace(sp.size ? `${pathname}?${sp}` : pathname, { scroll: false })
  }

  // ── every item of every kind, one shape ──
  const usedByFlows = (atomId: string) => overview?.agents.filter((a) => a.knowledge.some((k) => k.id === atomId)).length ?? 0
  const shared: Item[] = catalog.filter((s) => s.tier === 'community').map((s) => {
    const meta = communityMeta(s)
    return { key: s.slug, kind: kindOf(s), title: s.name, desc: s.summary, href: `${hrefBase}/${communitySegment(s.slug)}`, source: 'community', meta, categories: meta?.industries ?? [], popularity: meta?.used_by ?? meta?.votes ?? 0 }
  })
  const flows: Item[] = REGISTRY_SKILLS.map((s) => ({
    key: s.id, kind: 'workflow', title: t(`skills.${s.id}.name`), desc: t(`skills.${s.id}.short`), href: `${hrefBase}/${agentSegment(s.id)}`,
    source: 'accounted', meta: null, categories: [], popularity: usage?.[s.id]?.count ?? 0,
  }))
  const packs: Item[] = options.filter((o) => o.tier !== 'community').map((o) => ({
    key: o.id, kind: 'rules', title: knowledgeName(o.id, o.title), desc: knowledgeDesc(o.id, o.summary), href: `${hrefBase}/${rulesSegment(o.id)}`,
    source: 'accounted', meta: null, categories: o.tier === 'vertical' || o.tier === 'modifier' ? [o.id] : [], popularity: usedByFlows(o.id), usedByFlows: usedByFlows(o.id),
  }))
  const ownFlows: Item[] = own.map((s) => ({ key: s.slug, kind: 'workflow', title: s.name, desc: s.summary, href: `${hrefBase}/${agentSegment(s.slug)}`, source: 'own', meta: null, categories: [], popularity: 0 }))
  const all = [...flows, ...packs, ...shared]
  const ofKind = all.filter((i) => i.kind === kind)

  // Egna: for flows, what the company made; for knowledge, what the company's flows carry.
  const carried = new Set(overview?.agents.flatMap((a) => a.knowledge.map((k) => k.id)) ?? [])
  const mine = kind === 'workflow' ? ownFlows : kind === 'rules' ? packs.filter((p) => carried.has(p.key)) : []

  const categories = options.filter((o) => o.tier === 'vertical' || o.tier === 'modifier')
    .map((o) => ({ id: o.id, name: knowledgeName(o.id, o.title).replace(/\s*\([^)]*\)\s*$/, ''), count: ofKind.filter((i) => i.categories.includes(o.id)).length }))
    .filter((c) => c.count > 0)
    .sort((a, b) => Number(b.id === companyIndustry) - Number(a.id === companyIndustry) || b.count - a.count)
  const categoryName = categories.find((c) => c.id === category)?.name ?? (category ? knowledgeName(category, category) : null)

  const query = q.trim().toLocaleLowerCase('sv')
  const sorted = (items: Item[]) => [...items].sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title, 'sv') : b.popularity - a.popularity)
  const listing = view === 'discover' && (showAll || !!category || !!query)
  const pool = view === 'own' ? mine : ofKind
  const listed = sorted(pool.filter((i) => (!category || i.categories.includes(category)) && (!query || `${i.title} ${i.desc}`.toLocaleLowerCase('sv').includes(query))))
  const top = sorted(ofKind).slice(0, TOP)

  // The featured slot: the company's own industry pack when there is one, otherwise the most used of this kind.
  const featured = (kind === 'rules' && companyIndustry ? packs.find((p) => p.key === companyIndustry) : undefined) ?? top[0]

  return (
    <div className={styles.catalog}>
      <div className={styles.catBar}>
        <div className={styles.catTabs} role="tablist" aria-label={t('kinds_label')}>
          {KINDS.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={k === kind} className={styles.catTab} onClick={() => go({ typ: k, kategori: null })}>{t(`kind_${k}`)}</button>
          ))}
        </div>
        <span className={styles.catDivider} aria-hidden />
        <SegmentedControl<'own' | 'discover'>
          aria-label={t('view_label')}
          value={view}
          onChange={(vy) => go({ vy, kategori: null })}
          options={[{ value: 'own', label: t('view_own') }, { value: 'discover', label: t('view_discover') }]}
        />
        <div className={styles.catTools}>
          <ToolbarSearch aria-label={t('search_label')} placeholder={t(`search_${kind}`)} value={q} onChange={(e) => setQ(e.target.value)} />
          {view === 'discover' && categories.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className={styles.sqBtn} aria-label={t('category_label')}><SlidersHorizontal className="h-4 w-4" aria-hidden /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{t('category_label')}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={category ?? 'all'} onValueChange={(v) => go({ kategori: v === 'all' ? null : v })}>
                  <DropdownMenuRadioItem value="all">{t('category_all')}</DropdownMenuRadioItem>
                  {categories.map((c) => <DropdownMenuRadioItem key={c.id} value={c.id}>{c.name}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className={styles.sqBtn} aria-label={t('sort_label')}><ArrowUpDown className="h-4 w-4" aria-hidden /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t('sort_label')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as 'popular' | 'name')}>
                <DropdownMenuRadioItem value="popular">{t('sort_popular')}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="name">{t('sort_name')}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" className="gap-1.5" disabled={!canWrite} onClick={onCreate}><Plus className="h-4 w-4" aria-hidden />{t('create_button')}</Button>
        </div>
      </div>

      {view === 'own' && (
        <section className={styles.catSection}>
          <div className={styles.catHead}><h2>{t(`own_${kind}_title`)}</h2></div>
          {listed.length === 0
            ? <div className={styles.placeEmpty}>{t(`own_${kind}_empty`, { client: clientName })}</div>
            : <ul className={styles.catGrid}>{listed.map((i) => <CatalogCard key={i.key} item={i} />)}</ul>}
        </section>
      )}

      {view === 'discover' && listing && (
        <section className={styles.catSection}>
          <div className={styles.catHead}>
            <h2>{categoryName ?? (query ? t('search_results') : t(`all_${kind}`))}<span className={styles.catCount}>{listed.length}</span></h2>
            <button type="button" className={styles.catLink} onClick={() => { setQ(''); go({ kategori: null }) }}><ArrowLeft className="h-4 w-4" aria-hidden />{t('back_overview')}</button>
          </div>
          {listed.length === 0
            ? <div className={styles.placeEmpty}>{category ? t('place_share_first', { place: categoryName ?? '' }) : t('place_empty')}</div>
            : <ul className={styles.catGrid}>{listed.map((i) => <CatalogCard key={i.key} item={i} />)}</ul>}
        </section>
      )}

      {view === 'discover' && !listing && (
        <>
          {gate ?? (featured && <Featured item={featured} industry={featured.categories.includes(companyIndustry ?? '')} />)}

          <section className={styles.catSection}>
            <div className={styles.catHead}>
              <h2>{t(`most_used_${kind}`)}</h2>
              {ofKind.length > TOP && <button type="button" className={styles.catLink} onClick={() => setShowAll(true)}>{t('show_all')}<ArrowRight className="h-4 w-4" aria-hidden /></button>}
            </div>
            {top.length === 0 ? <div className={styles.placeEmpty}>{t(`community_empty_${kind}`)}</div> : <ul className={styles.catGrid}>{top.map((i) => <CatalogCard key={i.key} item={i} />)}</ul>}
          </section>

          {categories.length > 0 && (
            <section className={styles.catSection}>
              <div className={styles.catHead}>
                <h2>{t('categories')}</h2>
                {categories.length > CATEGORIES_SHOWN && (
                  <button type="button" className={styles.catLink} onClick={() => setAllCategories(!allCategories)}>
                    {t(allCategories ? 'show_fewer' : 'show_all_count', { count: categories.length })}
                    {allCategories ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
                  </button>
                )}
              </div>
              <ul className={styles.categoryGrid}>
                {(allCategories ? categories : categories.slice(0, CATEGORIES_SHOWN)).map((c) => {
                  const Icon = CATEGORY_ICONS[c.id.split('/')[1] ?? ''] ?? Briefcase
                  return (
                    <li key={c.id}>
                      <button type="button" className={styles.categoryCard} onClick={() => go({ kategori: c.id })}>
                        <span className={styles.categoryIcon}><Icon className="h-6 w-6" strokeWidth={1.5} aria-hidden /></span>
                        <span className={styles.categoryName}>{c.name}{c.id === companyIndustry && <small>{t('industry_yours')}</small>}</span>
                        <span className={styles.catCount}>{c.count}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}

/** One item in the catalogue: its picture on a tile, name, what it does, and who stands behind it. */
function CatalogCard({ item }: { item: Item }) {
  const t = useTranslations('skills_registry')
  const meta = item.meta
  const rated = meta ? meta.works + meta.not_works : 0
  const by = item.source === 'community' && meta ? `@${meta.author}` : item.source === 'own' ? t('source_own') : 'Accounted'
  const facts = [
    t('by', { who: by }),
    meta && meta.used_by ? t('used_by_companies', { count: meta.used_by }) : null,
    meta && rated > 0 ? t('works_share', { pct: Math.round((meta.works / rated) * 100) }) : null,
    item.usedByFlows ? t('used_by', { count: item.usedByFlows }) : null,
  ].filter(Boolean).join(' · ')
  return (
    <li>
      <Link href={item.href} className={styles.ccard}>
        <span className={styles.ccIcon}><ItemSymbol kind={item.kind} hue={itemHue(item.kind, item.key, item.source === 'accounted' && item.kind === 'workflow' ? item.key as never : null)} seedKey={item.key} size={40} /></span>
        <span className={styles.ccText}>
          <b data-ph-mask={item.source === 'own' ? '' : undefined}>{item.title}{meta?.author_verified && <span className={styles.verified} title={t('author_verified')}>✓</span>}</b>
          <span className={styles.ccDesc} data-ph-mask={item.source === 'own' ? '' : undefined}>{item.desc}</span>
          <small>{facts}{meta && <> · <span className={styles.voteMini}><ChevronUp className="h-3 w-3" aria-hidden />{meta.votes}</span></>}</small>
        </span>
      </Link>
    </li>
  )
}

/** The featured slot at the top of Upptäck, as Claude's "From Anthropic" banner. */
function Featured({ item, industry }: { item: Item; industry: boolean }) {
  const t = useTranslations('skills_registry')
  const hue = itemHue(item.kind, item.key, item.source === 'accounted' && item.kind === 'workflow' ? item.key as never : null)
  return (
    <section className={styles.featured} style={{ background: `hsl(${hue} 32% 90%)` }}>
      <div className={styles.featuredText}>
        <span>{industry ? t('featured_industry') : item.source === 'community' && item.meta ? t('featured_community', { who: `@${item.meta.author}` }) : t('featured_accounted')}</span>
        <h2>{item.title}</h2>
        <p>{item.desc}</p>
        <div><Button asChild size="sm"><Link href={item.href}>{t('open_hint')}</Link></Button></div>
      </div>
      <span className={styles.featuredArt}><ItemSymbol kind={item.kind} hue={hue} seedKey={item.key} size={120} open /></span>
    </section>
  )
}

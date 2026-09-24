'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { ToolbarSearch } from '@/components/ui/toolbar-search'
import { useCompanyOptional } from '@/contexts/CompanyContext'
import type { ArkivDocumentRow } from '@/app/api/arkiv/documents/route'
import { DOC_TYPES } from '@/lib/documents/classify/taxonomy'
import { buildConnections, layoutConnections, drawsDocuments, type ConnectionDocument } from '@/lib/arkiv/connections'

/**
 * /arkiv/kopplingar: the company in the middle, the counterparties around
 * it, the documents that bind them. One SVG from a deterministic layout
 * (lib/arkiv/connections.ts): the same archive draws the same picture, no
 * physics, no library. A counterparty opens the search for its name, a
 * document opens its page.
 */
const LIMIT = 500
const WIDTH = 960
const HEIGHT = 620
const COMPANY_H = 40
const DOC_R = 7
/** Geist at 15px runs about 8px per character; the pill is sized from that, never measured. */
const pillWidth = (label: string) => Math.max(96, Math.round(label.length * 8.2) + 28)

const shortName = (name: string) => {
  const trimmed = name.replace(/\s+(AB|HB|KB|Inc\.?|Ltd\.?)$/i, '').trim()
  return trimmed.length > 22 ? `${trimmed.slice(0, 21)}…` : trimmed
}

export function ArkivConnections() {
  const t = useTranslations('arkiv')
  const router = useRouter()
  const company = useCompanyOptional()?.company ?? null
  const [rows, setRows] = useState<ArkivDocumentRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/arkiv/documents?limit=${LIMIT}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        const { data } = (await res.json()) as { data: ArkivDocumentRow[] }
        if (!cancelled) setRows(data)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const documents = useMemo<ConnectionDocument[]>(
    () =>
      (rows ?? []).map((r) => ({
        document_id: r.document_id,
        title: r.title,
        doc_type: r.doc_type,
        counterparty: r.counterparty,
        document_date: r.document_date,
        created_at: r.created_at,
        href: r.href,
        voucher: r.linked.voucher,
      })),
    [rows],
  )
  const exclude = company?.name ?? null
  const all = useMemo(() => buildConnections(documents, { exclude }), [documents, exclude])
  const connections = useMemo(() => buildConnections(documents, { filter: query.trim() || undefined, exclude }), [documents, query, exclude])
  const layout = useMemo(() => layoutConnections(connections.parties, WIDTH, HEIGHT), [connections])

  const typeLabel = (docType: string | null) => (docType && (DOC_TYPES as readonly string[]).includes(docType) ? t(`types.${docType}` as never) : t('type_unknown'))
  const edgeLabel = (types: Array<{ doc_type: string; count: number }>, count: number) => {
    const first = types[0]
    if (!first) return String(count)
    const label = typeLabel(first.doc_type)
    return count > 1 ? `${label} · ${count}` : label
  }
  const openParty = (name: string) => router.push(`/arkiv?q=${encodeURIComponent(name)}`)
  const onKey = (e: React.KeyboardEvent, go: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      go()
    }
  }
  /** Labels sit beside the node on the sides, above or below it at the top and bottom of the ring. */
  const labelAt = (x: number, y: number, angle: number, r: number) => {
    const c = Math.cos(angle)
    if (c > 0.3) return { x: x + r + 6, y: y + 4, anchor: 'start' as const }
    if (c < -0.3) return { x: x - r - 6, y: y + 4, anchor: 'end' as const }
    return Math.sin(angle) < 0 ? { x, y: y - r - 8, anchor: 'middle' as const } : { x, y: y + r + 14, anchor: 'middle' as const }
  }

  const nothingAtAll = rows && all.parties.length === 0
  const nothingMatches = rows && all.parties.length > 0 && connections.parties.length === 0

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToolbarSearch id="arkiv-connections-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('connections_search')} containerClassName="w-72" autoComplete="off" />
        {rows && rows.length > 0 ? (
          <span className="ml-auto text-[12.5px] text-muted-foreground">
            {t('tree_count', { count: rows.length })}
            {all.unattached > 0 ? ` · ${t('connections_unattached', { count: all.unattached })}` : ''}
          </span>
        ) : null}
      </div>

      {failed && <p className="text-[13px] text-muted-foreground">{t('load_failed')}</p>}
      {!rows && !failed && <Skeleton className="aspect-[960/620] w-full" />}
      {nothingAtAll ? <EmptyState title={t('connections_empty_title')} description={t('connections_empty_body')} /> : null}
      {nothingMatches ? <p className="text-[13px] text-muted-foreground">{t('connections_none_match', { query: query.trim() })}</p> : null}

      {rows && connections.parties.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block h-auto w-full" role="img" aria-label={t('connections_title')}>
            {/* Edges first, so the nodes cover their ends. */}
            {layout.placed.map((p) => (
              <g key={`e-${p.party.id}`}>
                <line x1={layout.center.x} y1={layout.center.y} x2={p.x} y2={p.y} className="stroke-border" strokeWidth={1} />
                {p.documents.map((d) => (
                  <line key={`de-${d.document.document_id}`} x1={p.x} y1={p.y} x2={d.x} y2={d.y} className="stroke-border" strokeWidth={1} />
                ))}
                {!drawsDocuments(p.party) ? (
                  <text
                    x={layout.center.x + (p.x - layout.center.x) * 0.72}
                    y={layout.center.y + (p.y - layout.center.y) * 0.72 - 4}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[11px]"
                  >
                    {edgeLabel(p.party.types, p.party.count)}
                  </text>
                ) : null}
              </g>
            ))}

            <g>
              {(() => {
                const label = shortName(company?.name ?? t('connections_company'))
                const w = pillWidth(label)
                return (
                  <>
                    <rect x={layout.center.x - w / 2} y={layout.center.y - COMPANY_H / 2} width={w} height={COMPANY_H} rx={COMPANY_H / 2} className="fill-secondary stroke-muted-foreground" strokeWidth={1} />
                    <text x={layout.center.x} y={layout.center.y + 5} textAnchor="middle" className="fill-foreground font-display text-[15px]">
                      {label}
                    </text>
                  </>
                )
              })()}
            </g>

            {layout.placed.map((p) => {
              const r = 14 + Math.min(p.party.count, 20) * 0.5
              const label = labelAt(p.x, p.y, p.angle, r)
              return (
                <g key={p.party.id}>
                  <g
                    role="link"
                    tabIndex={0}
                    aria-label={p.party.name}
                    className="cursor-pointer outline-none focus-visible:[&_circle]:stroke-foreground"
                    onClick={() => openParty(p.party.name)}
                    onKeyDown={(e) => onKey(e, () => openParty(p.party.name))}
                  >
                    <circle cx={p.x} cy={p.y} r={r} className="fill-background stroke-muted-foreground" strokeWidth={1.2} />
                    <title>{`${p.party.name} · ${t('tree_count', { count: p.party.count })}`}</title>
                    <text x={label.x} y={label.y} textAnchor={label.anchor} className="fill-foreground text-[12.5px]">
                      {shortName(p.party.name)}
                    </text>
                  </g>
                  {p.documents.map((d) => {
                    const dl = labelAt(d.x, d.y, p.angle, DOC_R)
                    const text = d.document.voucher ? `${typeLabel(d.document.doc_type)} · ${d.document.voucher}` : typeLabel(d.document.doc_type)
                    return (
                      <g
                        key={d.document.document_id}
                        role="link"
                        tabIndex={0}
                        aria-label={d.document.title}
                        className="cursor-pointer outline-none focus-visible:[&_circle]:stroke-foreground"
                        onClick={() => router.push(d.document.href)}
                        onKeyDown={(e) => onKey(e, () => router.push(d.document.href))}
                      >
                        <circle cx={d.x} cy={d.y} r={DOC_R} className="fill-background stroke-border" strokeWidth={1} strokeDasharray="2 2" />
                        <title>{d.document.title}</title>
                        <text x={dl.x} y={dl.y} textAnchor={dl.anchor} className="fill-muted-foreground text-[11px]">
                          {text}
                        </text>
                      </g>
                    )
                  })}
                </g>
              )
            })}
          </svg>
        </div>
      ) : null}

      {rows && connections.hidden > 0 ? <p className="text-[12.5px] text-muted-foreground">{t('connections_hidden', { count: connections.hidden })}</p> : null}
    </div>
  )
}

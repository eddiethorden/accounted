import { describe, it, expect } from 'vitest'
import { buildConnections, layoutConnections, type ConnectionDocument } from '../connections'

const doc = (over: Partial<ConnectionDocument> & { document_id: string }): ConnectionDocument => ({
  title: over.document_id,
  doc_type: 'receipt',
  counterparty: null,
  document_date: null,
  created_at: '2026-09-01T00:00:00Z',
  href: `/arkiv/dokument/${over.document_id}`,
  voucher: null,
  ...over,
})

describe('buildConnections', () => {
  it('groups documents by counterparty regardless of case and spacing, most connected first, newest document first', () => {
    const rows = [
      doc({ document_id: 'a', counterparty: 'Almi Stockholm AB', doc_type: 'agreement.loan', document_date: '2026-02-02', voucher: 'A118' }),
      doc({ document_id: 'b', counterparty: 'Systembolaget', document_date: '2026-09-11' }),
      doc({ document_id: 'c', counterparty: 'SYSTEMBOLAGET ', document_date: '2026-09-12' }),
      doc({ document_id: 'd', counterparty: 'systembolaget', document_date: '2026-08-01' }),
      doc({ document_id: 'e', counterparty: null }),
    ]
    const c = buildConnections(rows)
    expect(c.unattached).toBe(1)
    expect(c.hidden).toBe(0)
    expect(c.parties.map((p) => [p.name, p.count])).toEqual([
      ['Systembolaget', 3],
      ['Almi Stockholm AB', 1],
    ])
    expect(c.parties[0].documents.map((d) => d.document_id)).toEqual(['c', 'b', 'd'])
    expect(c.parties[0].types).toEqual([{ doc_type: 'receipt', count: 3 }])
    expect(c.parties[1].documents[0].voucher).toBe('A118')
  })

  it('draws at most `max` counterparties, counts the rest, and filters by a name fragment', () => {
    const rows = ['Almi', 'Balzac', 'Bolagsverket', 'Propel', 'Skatteverket'].flatMap((name, i) =>
      Array.from({ length: i + 1 }, (_, j) => doc({ document_id: `${name}-${j}`, counterparty: name })),
    )
    const top = buildConnections(rows, { max: 3 })
    expect(top.parties.map((p) => p.name)).toEqual(['Skatteverket', 'Propel', 'Bolagsverket'])
    expect(top.hidden).toBe(2)
    const verket = buildConnections(rows, { filter: 'verket' })
    expect(verket.parties.map((p) => p.name)).toEqual(['Skatteverket', 'Bolagsverket'])
    expect(verket.hidden).toBe(0)
  })
})

describe('layoutConnections', () => {
  it('places the first counterparty at twelve o clock on one ellipse and draws documents only for the few-document ones', () => {
    const rows = [
      doc({ document_id: 'a', counterparty: 'Almi' }),
      doc({ document_id: 'b', counterparty: 'Almi' }),
      ...Array.from({ length: 5 }, (_, j) => doc({ document_id: `s-${j}`, counterparty: 'Systembolaget' })),
    ]
    const layout = layoutConnections(buildConnections(rows).parties, 960, 620)
    expect(layout.center).toEqual({ x: 480, y: 310 })
    const [systembolaget, almi] = layout.placed
    expect(systembolaget.party.name).toBe('Systembolaget')
    expect(Math.round(systembolaget.x)).toBe(480)
    expect(systembolaget.y).toBeLessThan(310)
    expect(systembolaget.documents).toEqual([])
    expect(almi.documents).toHaveLength(2)
    // Both document nodes sit outside the ring, on Almi's side.
    for (const d of almi.documents) expect(d.y).toBeGreaterThan(almi.y)
    // The same archive draws the same picture.
    expect(layoutConnections(buildConnections(rows).parties, 960, 620)).toEqual(layout)
  })
})

/**
 * Kopplingar (2026-09-24): the company in the middle, its counterparties
 * around it, and the documents that bind them. Drawn from what the shelf
 * already knows without interpretation: the counterparty a document names,
 * the verifikat it sits on. No facts, no amounts on the edges, no guesses:
 * those are the brain's and come later.
 */
export interface ConnectionDocument {
  document_id: string
  title: string
  doc_type: string | null
  counterparty: string | null
  document_date: string | null
  created_at: string
  href: string
  voucher: string | null
}

export interface PartyNode {
  /** Stable key: the name folded for case and whitespace. */
  id: string
  name: string
  count: number
  /** Document types under this counterparty, most common first. */
  types: Array<{ doc_type: string; count: number }>
  /** Newest first. */
  documents: ConnectionDocument[]
}

export interface Connections {
  parties: PartyNode[]
  /** Counterparties beyond `max`, left out of the drawing. */
  hidden: number
  /** Documents that name no counterparty; they are in the tree, not here. */
  unattached: number
}

/** More than this many nodes on one ring and the labels collide. */
export const MAX_PARTIES = 20

const fold = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('sv')
const dated = (d: ConnectionDocument) => d.document_date ?? d.created_at.slice(0, 10)

export function buildConnections(rows: readonly ConnectionDocument[], opts: { max?: number; filter?: string } = {}): Connections {
  const max = opts.max ?? MAX_PARTIES
  const filter = opts.filter ? fold(opts.filter) : ''
  const byId = new Map<string, PartyNode>()
  let unattached = 0
  for (const row of rows) {
    const name = row.counterparty?.trim().replace(/\s+/g, ' ')
    if (!name) {
      unattached += 1
      continue
    }
    const id = fold(name)
    let party = byId.get(id)
    if (!party) {
      party = { id, name, count: 0, types: [], documents: [] }
      byId.set(id, party)
    }
    party.count += 1
    party.documents.push(row)
  }
  let parties = [...byId.values()]
  if (filter) parties = parties.filter((p) => p.id.includes(filter))
  for (const party of parties) {
    party.documents.sort((a, b) => (dated(a) < dated(b) ? 1 : dated(a) > dated(b) ? -1 : 0))
    const counts = new Map<string, number>()
    for (const d of party.documents) if (d.doc_type) counts.set(d.doc_type, (counts.get(d.doc_type) ?? 0) + 1)
    party.types = [...counts.entries()].map(([doc_type, count]) => ({ doc_type, count })).sort((a, b) => b.count - a.count || a.doc_type.localeCompare(b.doc_type))
  }
  parties.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'sv'))
  const shown = parties.slice(0, max)
  return { parties: shown, hidden: parties.length - shown.length, unattached }
}

export interface PlacedDocument {
  document: ConnectionDocument
  x: number
  y: number
}

export interface PlacedParty {
  party: PartyNode
  x: number
  y: number
  /** Radians, 0 at three o'clock, clockwise (SVG y grows downward). */
  angle: number
  /** Drawn only for a counterparty with few documents; a big one carries a count on its edge instead. */
  documents: PlacedDocument[]
}

export interface ConnectionLayout {
  width: number
  height: number
  center: { x: number; y: number }
  placed: PlacedParty[]
}

/** A counterparty with at most this many documents gets them drawn as nodes of their own. */
export const DOCUMENT_NODES_MAX = 2

/**
 * A deterministic radial layout: the counterparties on one ellipse around
 * the company, evenly spaced, the most connected first at twelve o'clock;
 * the few-document counterparties get their documents just outside the ring.
 * No physics: the same archive always draws the same picture.
 */
export function layoutConnections(parties: readonly PartyNode[], width = 960, height = 620): ConnectionLayout {
  const center = { x: width / 2, y: height / 2 }
  const rx = width * 0.36
  const ry = height * 0.33
  const n = parties.length
  const placed: PlacedParty[] = parties.map((party, i) => {
    const angle = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2
    const x = center.x + rx * Math.cos(angle)
    const y = center.y + ry * Math.sin(angle)
    const docs = party.count <= DOCUMENT_NODES_MAX ? party.documents : []
    const documents = docs.map((document, j) => {
      const spread = docs.length === 1 ? 0 : (j === 0 ? -0.14 : 0.14)
      const a = angle + spread
      return { document, x: center.x + (rx + 64) * Math.cos(a), y: center.y + (ry + 44) * Math.sin(a) }
    })
    return { party, x, y, angle, documents }
  })
  return { width, height, center, placed }
}

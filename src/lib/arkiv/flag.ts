/**
 * Arkiv has two layers with two gates.
 *
 * The shelf is on for every company: upload, read the pages, a cheap type,
 * the list, search, and the pages served to an agent. It costs no model call
 * beyond reading (text layers are free; photos go through the vision model
 * under the daily page budget), it writes nothing into the company, and it
 * is version one: documents stored almost raw, an agent able to read them.
 *
 * The brain rolls out per company: extraction, facts, agreements with their
 * obligations, findings, questions, the graph. ARKIV_BRAIN_COMPANY_IDS lists
 * the companies (comma-separated ids, or `*` for everyone); unset means
 * nobody, so a deploy never starts extracting every archive at once.
 *
 * ARKIV_COMPANY_IDS, the flag the pilot used, is no longer read.
 */
export function arkivBrainRollout(): 'all' | string[] {
  const raw = process.env.ARKIV_BRAIN_COMPANY_IDS?.trim()
  if (!raw) return []
  if (raw === '*') return 'all'
  // Each company once: the crons walk this list, and a repeated id would take a slot per repeat.
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))]
}

/** The brain: only for the companies in ARKIV_BRAIN_COMPANY_IDS. */
export function isArkivBrainEnabled(companyId: string | null | undefined): boolean {
  if (!companyId) return false
  const rollout = arkivBrainRollout()
  return rollout === 'all' || rollout.includes(companyId)
}

/** The shelf: every company. Kept as a function so a caller reads as a gate; a company id is still required. */
export function isArkivEnabled(companyId: string | null | undefined): boolean {
  return !!companyId
}

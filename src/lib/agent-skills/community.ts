import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import type { COMMUNITY_KINDS } from './validation'

/**
 * Community items: agent instructions a company shared, reviewed and published
 * as tier 'community' atoms. The author says what kind of item it is when
 * submitting (stored on the company_skills submission), and
 * every user may vote on it and answer "fungerar det?" (community_feedback).
 */

export type CommunityKind = (typeof COMMUNITY_KINDS)[number]
export type CommunityAnswer = 'works' | 'not_works'

/** What the catalog tells the page about a community item. */
export interface CommunityMeta {
  kind: CommunityKind
  /** The author_handle chosen at submission. */
  author: string
  /** How many of this author's items are published. */
  author_shared: number
  /** The author shared from an accounting firm (a byrå team). */
  author_verified: boolean
  votes: number
  /** The current user voted. */
  voted: boolean
  works: number
  not_works: number
  /** The current user's answer. */
  feedback: CommunityAnswer | null
  reviewed_at: string | null
  /** Companies that loaded it (mcp.skill_loaded) while event_log keeps skill loads. */
  used_by: number | null
}

export const CommunityFeedbackSchema = z.object({
  slug: z.string().regex(/^community\/[a-z0-9][a-z0-9-]{0,99}$/),
  vote: z.boolean().optional(),
  feedback: z.enum(['works', 'not_works']).nullable().optional(),
}).strict().refine((input) => input.vote !== undefined || input.feedback !== undefined, 'Send vote, feedback or both.')
export type CommunityFeedbackInput = z.infer<typeof CommunityFeedbackSchema>

/** A live, published community item: the only thing that can be rated. */
export async function isLiveCommunityItem(supabase: SupabaseClient, slug: string): Promise<boolean> {
  if (!slug.startsWith('community/')) return false
  const { data, error } = await supabase.from('agent_atom_registry').select('id')
    .eq('id', slug).eq('tier', 'community').eq('is_active', true).eq('mcp_exposed', true).is('parent_atom_id', null).maybeSingle()
  if (error) throw error
  return !!data
}

/**
 * Saves one person's vote and/or answer on a community item. The two are
 * independent: a field left out keeps its saved value, `feedback: null`
 * clears the answer. Shared by the Skills page route and the MCP feedback
 * tool, so both write the same row. The caller has authorized `companyId`
 * for `userId`; the filter is explicit because the MCP client is service role.
 */
export async function recordCommunityFeedback(
  supabase: SupabaseClient,
  { companyId, userId, slug, vote, feedback }: { companyId: string; userId: string } & CommunityFeedbackInput,
): Promise<{ vote: boolean; feedback: CommunityAnswer | null } | null> {
  if (!(await isLiveCommunityItem(supabase, slug))) return null
  const row: Record<string, unknown> = { atom_id: slug, company_id: companyId, user_id: userId }
  if (vote !== undefined) row.vote = vote
  if (feedback !== undefined) row.feedback = feedback
  const { data, error } = await supabase.from('community_feedback')
    .upsert(row, { onConflict: 'atom_id,user_id' })
    .select('vote, feedback').single()
  if (error) throw error
  return data as { vote: boolean; feedback: CommunityAnswer | null }
}

interface StatsRow {
  atom_id: string
  kind: CommunityKind
  author: string | null
  author_shared: number
  author_verified: boolean
  votes: number
  works: number
  not_works: number
  used_by: number | null
}

/**
 * Adds `community` to every tier 'community' item: the counts across all
 * companies (community_item_stats) and the caller's own vote and answer. Two
 * reads whatever the number of items.
 */
export async function attachCommunityMeta<T extends { slug: string; tier: string; reviewedAt?: string | null }>(
  supabase: SupabaseClient, skills: T[], userId: string,
): Promise<Array<T & { community?: CommunityMeta }>> {
  if (!skills.some((skill) => skill.tier === 'community')) return skills
  const [stats, mine] = await Promise.all([
    supabase.rpc('community_item_stats').then(({ data, error }) => { if (error) throw error; return (data ?? []) as StatsRow[] }),
    fetchAllRows<{ id: string; atom_id: string; vote: boolean; feedback: CommunityAnswer | null }>((range) =>
      supabase.from('community_feedback').select('id, atom_id, vote, feedback').eq('user_id', userId).order('id').range(range.from, range.to)),
  ])
  const statsBy = new Map(stats.map((row) => [row.atom_id, row]))
  const mineBy = new Map(mine.map((row) => [row.atom_id, row]))
  return skills.map((skill) => {
    if (skill.tier !== 'community') return skill
    const row = statsBy.get(skill.slug)
    const own = mineBy.get(skill.slug)
    const community: CommunityMeta = {
      kind: row?.kind ?? 'workflow',
      author: row?.author ?? '',
      author_shared: row?.author_shared ?? 0,
      author_verified: row?.author_verified ?? false,
      votes: row?.votes ?? 0,
      voted: own?.vote ?? false,
      works: row?.works ?? 0,
      not_works: row?.not_works ?? 0,
      feedback: own?.feedback ?? null,
      reviewed_at: skill.reviewedAt ?? null,
      used_by: row ? row.used_by : null,
    }
    return { ...skill, community }
  })
}

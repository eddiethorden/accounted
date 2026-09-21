// The assistant's identity as the dashboard chrome sees it, resolved from the
// company's agent_profiles row. No 'use client': the server layout builds the
// value and the client provider carries it.

export interface AgentIdentity {
  displayName: string | null
  avatarId: string | null
  // True once the company has completed the personalization flow
  // (/onboarding/agent, Phase B verification). Personalization state ONLY:
  // it must never decide whether an assistant entry point is visible. Most
  // onboarded companies have no agent_profiles row at all, and the assistant
  // works for them with the defaults below (see agent-trigger-visibility.ts
  // for the incident this rule comes from).
  isVerified: boolean
}

export interface AgentProfileIdentityRow {
  display_name: string | null
  avatar_id: string | null
  verified_at: string | null
}

// No name and no avatar: every consumer already falls back to a generic label
// ("min assistent", "Assistent") and AgentAvatar to its default face.
export const DEFAULT_AGENT_IDENTITY: AgentIdentity = {
  displayName: null,
  avatarId: null,
  isVerified: false,
}

/**
 * A missing row and an unverified row both resolve to a usable identity: the
 * row only adds the chosen name and face. Blank names read as unset.
 */
export function resolveAgentIdentity(
  row: AgentProfileIdentityRow | null | undefined,
): AgentIdentity {
  if (!row) return DEFAULT_AGENT_IDENTITY
  return {
    displayName: row.display_name?.trim() || null,
    avatarId: row.avatar_id?.trim() || null,
    isVerified: Boolean(row.verified_at),
  }
}

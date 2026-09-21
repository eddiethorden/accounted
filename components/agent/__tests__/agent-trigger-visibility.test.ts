import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  decideAgentTrigger,
  type AgentTriggerInput,
  type AgentTriggerMode,
} from '../agent-trigger-visibility'
import {
  DEFAULT_AGENT_IDENTITY,
  resolveAgentIdentity,
  type AgentProfileIdentityRow,
} from '../agent-identity'

/**
 * What this protects: the floating assistant button used to end its guard
 * chain with `if (!identity.isVerified) return null`, and the bottom nav, the
 * sidebar, the command palette, Settings and /chat repeated the same gate. The
 * onboarding journey stopped visiting /onboarding/agent, so most onboarded
 * companies (payers and trials included) had no way to reach the assistant.
 * The decision below must never depend on the agent profile again.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..')
const SCAN_DIRS = ['app', 'components']
// The definition site, the decision module (its header quotes the old gate as
// history) and this test are the only files allowed to spell it.
const DEFINITION_FILES = new Set([
  'components/agent/agent-identity.ts',
  'components/agent/agent-trigger-visibility.ts',
  'components/agent/__tests__/agent-trigger-visibility.test.ts',
])

function filesReadingIsVerified(): string[] {
  const hits: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next') continue
        walk(full)
        continue
      }
      if (!/\.tsx?$/.test(entry.name)) continue
      const rel = relative(REPO_ROOT, full).split('\\').join('/')
      if (DEFINITION_FILES.has(rel)) continue
      if (/\bisVerified\b/.test(readFileSync(full, 'utf8'))) hits.push(rel)
    }
  }
  for (const dir of SCAN_DIRS) walk(join(REPO_ROOT, dir))
  return hits.sort()
}

const base: AgentTriggerInput = {
  hiddenByPreference: false,
  hasAi: true,
  upsellDismissed: false,
  isOpen: false,
  collapsed: false,
  pathname: '/transactions',
}

// The three shapes agent_profiles can be in for an onboarded company.
const PROFILE_STATES: { label: string; row: AgentProfileIdentityRow | null }[] = [
  { label: 'no agent_profiles row', row: null },
  {
    label: 'row composed but never verified',
    row: { display_name: null, avatar_id: null, verified_at: null },
  },
  {
    label: 'verified row',
    row: { display_name: 'Anna', avatar_id: 'notionists-3', verified_at: '2026-06-02T08:00:00Z' },
  },
]

describe('resolveAgentIdentity', () => {
  it('gives a company with no profile row the default identity', () => {
    expect(resolveAgentIdentity(null)).toEqual(DEFAULT_AGENT_IDENTITY)
    expect(resolveAgentIdentity(undefined)).toEqual(DEFAULT_AGENT_IDENTITY)
    expect(DEFAULT_AGENT_IDENTITY).toEqual({ displayName: null, avatarId: null, isVerified: false })
  })

  it('carries the chosen name and avatar from a verified row', () => {
    expect(
      resolveAgentIdentity({
        display_name: 'Anna',
        avatar_id: 'notionists-3',
        verified_at: '2026-06-02T08:00:00Z',
      }),
    ).toEqual({ displayName: 'Anna', avatarId: 'notionists-3', isVerified: true })
  })

  it('keeps an unverified row usable: name if any, not verified', () => {
    expect(
      resolveAgentIdentity({ display_name: 'Anna', avatar_id: null, verified_at: null }),
    ).toEqual({ displayName: 'Anna', avatarId: null, isVerified: false })
  })

  it('reads a blank name or avatar as unset so consumers fall back to their generic label', () => {
    expect(
      resolveAgentIdentity({ display_name: '   ', avatar_id: '', verified_at: null }),
    ).toEqual(DEFAULT_AGENT_IDENTITY)
  })
})

describe('decideAgentTrigger', () => {
  describe('the agent profile never decides visibility', () => {
    for (const { label, row } of PROFILE_STATES) {
      // The decision takes no identity, so the profile cannot reach it; the
      // resolver is what has to hold up for each profile shape.
      it(`${label}: resolves to an identity and the door is the same`, () => {
        expect(() => resolveAgentIdentity(row)).not.toThrow()
        expect(decideAgentTrigger({ ...base, hasAi: true })).toBe('ask')
        expect(decideAgentTrigger({ ...base, hasAi: false })).toBe('upsell')
      })
    }

    it('has no profile-shaped input to gate on', () => {
      expect(Object.keys(base).sort()).toEqual(
        ['collapsed', 'hasAi', 'hiddenByPreference', 'isOpen', 'pathname', 'upsellDismissed'].sort(),
      )
    })

    // The gate was copy-pasted across six surfaces (FAB, sidebar, bottom nav,
    // command palette, Settings nav, Dokumentinkorgen) plus a redirect in the
    // /chat layout, which is why removing it in one place would not have been
    // enough. No UI file may read the flag again without saying why here.
    it('no entry point in app/ or components/ reads identity.isVerified', () => {
      // file (repo-relative) -> why reading the flag there is not a visibility gate
      const ALLOWED: Record<string, string> = {}
      const offenders = filesReadingIsVerified().filter((f) => !(f in ALLOWED))
      expect(
        offenders,
        'isVerified is personalization state, never a reason to hide an assistant entry point. ' +
          'If this use is not a visibility gate, add the file to ALLOWED with the reason.',
      ).toEqual([])
    })
  })

  const table: { name: string; input: Partial<AgentTriggerInput>; expected: AgentTriggerMode }[] = [
    // Entitlement axis
    { name: 'payer, fresh', input: {}, expected: 'ask' },
    { name: 'non-payer, fresh: conversion pill', input: { hasAi: false }, expected: 'upsell' },
    {
      name: 'non-payer who dismissed the pill this session',
      input: { hasAi: false, upsellDismissed: true },
      expected: 'hidden',
    },
    {
      name: 'a stale dismissal flag never hides the pill from a payer',
      input: { hasAi: true, upsellDismissed: true },
      expected: 'ask',
    },

    // User preference (Inställningar > Assistenten)
    { name: 'hidden by preference, payer', input: { hiddenByPreference: true }, expected: 'hidden' },
    {
      name: 'hidden by preference, non-payer',
      input: { hiddenByPreference: true, hasAi: false },
      expected: 'hidden',
    },

    // Sheet state
    { name: 'sheet open and visible', input: { isOpen: true }, expected: 'hidden' },
    { name: 'collapsed session: the handle', input: { isOpen: true, collapsed: true }, expected: 'resume' },
    {
      name: 'collapsed session survives the hide preference',
      input: { isOpen: true, collapsed: true, hiddenByPreference: true },
      expected: 'resume',
    },
    {
      name: 'collapsed session survives a dismissed upsell',
      input: { isOpen: true, collapsed: true, hasAi: false, upsellDismissed: true },
      expected: 'resume',
    },
    {
      name: 'collapsed session for a non-payer is a resume handle, not the ad',
      input: { isOpen: true, collapsed: true, hasAi: false },
      expected: 'resume',
    },

    // Suppressed paths
    { name: '/chat, fresh', input: { pathname: '/chat' }, expected: 'hidden' },
    { name: '/chat/[id], fresh', input: { pathname: '/chat/7b1e' }, expected: 'hidden' },
    {
      name: '/chat, collapsed: the page is the way back',
      input: { pathname: '/chat', isOpen: true, collapsed: true },
      expected: 'hidden',
    },
    { name: '/chat, non-payer', input: { pathname: '/chat', hasAi: false }, expected: 'hidden' },
    {
      name: 'verifikation editor, fresh',
      input: { pathname: '/bookkeeping/3f2a9c1e' },
      expected: 'hidden',
    },
    {
      name: 'verifikation editor, non-payer fresh',
      input: { pathname: '/bookkeeping/3f2a9c1e', hasAi: false },
      expected: 'hidden',
    },
    {
      name: 'verifikation editor, collapsed: keeps its handle',
      input: { pathname: '/bookkeeping/3f2a9c1e', isOpen: true, collapsed: true },
      expected: 'resume',
    },
    { name: '/bookkeeping list is not the editor', input: { pathname: '/bookkeeping' }, expected: 'ask' },
    { name: '/bookkeeping/new is not the editor', input: { pathname: '/bookkeeping/new' }, expected: 'ask' },
    {
      name: '/bookkeeping/year-end is not the editor',
      input: { pathname: '/bookkeeping/year-end' },
      expected: 'ask',
    },
    { name: 'Hem', input: { pathname: '/' }, expected: 'ask' },
    { name: 'pathname not resolved yet', input: { pathname: null }, expected: 'ask' },
  ]

  for (const row of table) {
    it(row.name, () => {
      expect(decideAgentTrigger({ ...base, ...row.input })).toBe(row.expected)
    })
  }
})

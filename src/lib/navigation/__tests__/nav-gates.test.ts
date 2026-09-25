import { describe, it, expect } from 'vitest'
import type { NavGateFlags } from '@/components/dashboard/nav-v2'
import { gateNavTree, isNavEmployer, passesNavGates, type NavGateContext } from '../nav-gates'

// The sidebar and the assistant's UI map share this gate, so a surface hides
// for the same reason in both. Each case: the flag that hides it, off vs on.

function ctx(overrides: Partial<NavGateContext> = {}): NavGateContext {
  return {
    entityType: 'aktiebolag',
    isEmployer: true,
    dimensionsEnabled: true,
    salesOrdersEnabled: true,
    quotesEnabled: true,
    hasWebshop: true,
    hasMileage: true,
    hasExpenseClaims: true,
    arkivEnabled: true,
    agentsEnabled: true,
    capabilities: ['ai'],
    hiddenNavHrefs: new Set(),
    agentVerified: true,
    ...overrides,
  }
}

const item = (flags: Partial<NavGateFlags>): NavGateFlags => ({ href: '/x', ...flags })

describe('passesNavGates', () => {
  const cases: Array<[string, NavGateFlags, Partial<NavGateContext>]> = [
    ['employerOnly', item({ employerOnly: true }), { isEmployer: false }],
    ['requiresDimensions', item({ requiresDimensions: true }), { dimensionsEnabled: false }],
    ['requiresSalesOrders', item({ requiresSalesOrders: true }), { salesOrdersEnabled: false }],
    ['requiresQuotes', item({ requiresQuotes: true }), { quotesEnabled: false }],
    ['requiresWebshop', item({ requiresWebshop: true }), { hasWebshop: false }],
    ['requiresMileage', item({ requiresMileage: true }), { hasMileage: false }],
    ['requiresExpenses', item({ requiresExpenses: true }), { hasExpenseClaims: false }],
    ['requiresArkiv', item({ requiresArkiv: true }), { arkivEnabled: false }],
    ['requiresAgents', item({ requiresAgents: true }), { agentsEnabled: false }],
    ['requiredCapability', item({ requiredCapability: 'ai' }), { capabilities: [] }],
    ['entityOnly', item({ entityOnly: 'aktiebolag' }), { entityType: 'enskild_firma' }],
    ['branding hidden href', item({ href: '/kpi' }), { hiddenNavHrefs: new Set(['/kpi']) }],
    ['/chat before the agent is built', item({ href: '/chat' }), { agentVerified: false }],
  ]

  it.each(cases)('%s: shown when the company has it, hidden when not', (_name, flags, off) => {
    expect(passesNavGates(flags, ctx())).toBe(true)
    expect(passesNavGates(flags, ctx(off))).toBe(false)
  })

  it('never shows hidden or byrå-only entries in the company nav', () => {
    expect(passesNavGates(item({ hidden: true }), ctx())).toBe(false)
    expect(passesNavGates(item({ byraOnly: true }), ctx())).toBe(false)
  })
})

describe('gateNavTree', () => {
  it('gates sections and their sub-items alike', () => {
    const tree = gateNavTree(
      [
        { href: '/a', labelKey: 'a', sub: [{ href: '/a/1', labelKey: 'a1' }, { href: '/a/2', labelKey: 'a2', requiresQuotes: true }] },
        { href: '/b', labelKey: 'b', employerOnly: true },
      ],
      ctx({ quotesEnabled: false, isEmployer: false }),
    )
    expect(tree).toEqual([{ href: '/a', labelKey: 'a', sub: [{ href: '/a/1', labelKey: 'a1' }] }])
  })
})

describe('isNavEmployer', () => {
  it('is true for a legal person by form, and for a sole trader only with pays_salaries', () => {
    expect(isNavEmployer('aktiebolag', false)).toBe(true)
    expect(isNavEmployer('enskild_firma', false)).toBe(false)
    expect(isNavEmployer('enskild_firma', true)).toBe(true)
    expect(isNavEmployer('not-a-form', false)).toBe(false)
  })
})

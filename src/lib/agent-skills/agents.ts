import type { RegistrySkillId } from './registry'

/**
 * Agenter: each curated skill is an agent built from four separate parts.
 *
 *  - Instruktioner: the workflow body (lib/agent-skills/workflows), how to do the job.
 *  - Kunskap: the reviewed swedish-* rule packs in agent_atom_registry. `knowledge`
 *    ids are inlined when the agent starts; `references` are listed by id and
 *    loaded on demand, so the law is in context before the first number is read.
 *  - Företaget: the company's industry and modifier atoms (agent_profiles), added
 *    per company at load time, not declared here.
 *  - Kopplingar: where the agent acts. `bank`, `skatteverket` and `peppol` are
 *    Accounted connections the page can check; `mail` and `browser` live in the
 *    customer's own AI client (Gmail connector, Claude in Chrome) and are only named.
 *
 * Browser-safe: the Agenter page imports this file. Every id must resolve to an
 * agent-audience atom (pinned by __tests__/agents.test.ts).
 */
export type AgentConnection = 'bank' | 'skatteverket' | 'peppol' | 'mail' | 'browser'

export interface AgentDefinition {
  knowledge: readonly string[]
  references: readonly string[]
  connections: readonly AgentConnection[]
}

const COMPLIANCE = 'horizontal/swedish-accounting-compliance'
const VAT = 'horizontal/swedish-vat'
const INVOICE = 'horizontal/swedish-invoice-compliance'
const YEAR_END = 'horizontal/swedish-year-end-closing'

export const AGENTS: Record<RegistrySkillId, AgentDefinition> = {
  bookkeep: {
    knowledge: [COMPLIANCE, VAT],
    references: [`${COMPLIANCE}/bas-kontoplan`, `${VAT}/vat-compliance-reference`, 'horizontal/swedish-asset-accounting/accounts-and-registry'],
    connections: ['bank', 'mail'],
  },
  kvittojakten: {
    knowledge: [COMPLIANCE, INVOICE],
    references: [`${COMPLIANCE}/bfl-bfnar`, `${INVOICE}/invoice-rules`],
    connections: ['mail', 'browser'],
  },
  'reconcile-month': {
    knowledge: [COMPLIANCE],
    references: [`${COMPLIANCE}/bas-kontoplan`, `${COMPLIANCE}/skatteverket`],
    connections: ['bank', 'skatteverket'],
  },
  'month-end-close': {
    knowledge: [COMPLIANCE, VAT],
    references: [`${COMPLIANCE}/bfl-bfnar`, `${VAT}/vat-compliance-reference`],
    connections: ['bank', 'skatteverket'],
  },
  'quarterly-vat-review': {
    knowledge: [VAT, COMPLIANCE],
    references: [`${VAT}/vat-compliance-reference`, `${COMPLIANCE}/skatteverket`],
    connections: ['skatteverket'],
  },
  'payroll-monthly': {
    knowledge: ['horizontal/swedish-payroll'],
    references: ['agi-filing', 'tax-tables', 'social-charges', 'vacation-pay', 'sick-pay', 'benefits', 'bas-7xxx'].map((r) => `horizontal/swedish-payroll/${r}`),
    connections: ['skatteverket', 'bank'],
  },
  'invoicing-rules': {
    knowledge: [INVOICE, VAT],
    references: [`${INVOICE}/invoice-rules`, 'horizontal/swedish-e-invoicing/swedish-cius-and-specifics', 'horizontal/swedish-e-invoicing/consumer-and-b2c'],
    connections: ['peppol', 'mail'],
  },
  'kreditfaktura-process': {
    knowledge: [INVOICE, VAT],
    references: [`${INVOICE}/invoice-rules`],
    connections: ['peppol'],
  },
  'year-end-close': {
    knowledge: [YEAR_END, 'horizontal/swedish-asset-accounting', 'horizontal/swedish-financial-reporting'],
    references: [
      `${YEAR_END}/closing-process`, `${YEAR_END}/journal-entries`, `${YEAR_END}/k2-vs-k3`, `${YEAR_END}/tax-calculations`,
      'horizontal/swedish-asset-accounting/depreciation', 'horizontal/swedish-financial-reporting/ink2-form-logic', 'horizontal/swedish-sru-filing/sru-codes',
    ],
    connections: ['skatteverket'],
  },
  'tax-planning': {
    knowledge: ['horizontal/swedish-tax-planning', YEAR_END],
    references: ['312-regler', 'periodiseringsfond', 'overavskrivningar', 'strategy-and-interactions'].map((r) => `horizontal/swedish-tax-planning/${r}`)
      .concat('horizontal/swedish-payroll/social-charges'),
    connections: [],
  },
}

/** Connections Accounted can check; `mail` and `browser` sit in the AI client. */
export const CHECKABLE_CONNECTIONS = ['bank', 'skatteverket', 'peppol'] as const
export type CheckableConnection = (typeof CHECKABLE_CONNECTIONS)[number]

export function isCheckable(connection: AgentConnection): connection is CheckableConnection {
  return (CHECKABLE_CONNECTIONS as readonly string[]).includes(connection)
}

/** Where the user fixes a missing Accounted connection. */
export const CONNECTION_SETTINGS: Record<CheckableConnection, string> = {
  bank: '/settings/banking',
  skatteverket: '/settings/tax',
  peppol: '/settings/invoicing',
}

/** `agent:<id>` for get_task. */
export function agentTaskKind(id: RegistrySkillId): string {
  return `agent:${id}`
}

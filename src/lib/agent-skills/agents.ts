import type { RegistrySkillId } from './registry'

/**
 * Agenter: each curated skill is an agent built from four separate parts.
 *
 *  - Instruktioner: the workflow body (lib/agent-skills/workflows), how to do the job.
 *  - Kunskap: the reviewed swedish-* rule packs in agent_atom_registry. `knowledge`
 *    ids are inlined when the agent starts; `references` are listed by id and
 *    loaded on demand, so the law is in context before the first number is read.
 *  - Företaget: what we know about this company. Industry and modifier atoms come
 *    from agent_profiles; `facts` names the company facts (lib/arkiv/facts/
 *    predicates.ts) that change what this agent does, inlined when it starts;
 *    `agreements` adds the running agreements. Everything else stays one lookup
 *    away (search_records, ask_document): eager for what acts, lazy for what informs.
 *  - Kopplingar: where the agent acts. `bank`, `skatteverket` and `peppol` are
 *    Accounted connections the page can check; `mail` and `browser` live in the
 *    customer's own AI client (Gmail connector, Claude in Chrome) and are only named.
 *
 * Each agent is met as a colleague: a first name, a role and a face (Notionists,
 * CC0, self-hosted like components/agent/avatars.ts; generated with
 * https://api.dicebear.com/9.x/notionists/svg?seed=<file name without agent->&radius=50&backgroundColor=f5f3ed).
 *
 * Browser-safe: the Agenter page imports this file. Every id must resolve to an
 * agent-audience atom (pinned by __tests__/agents.test.ts).
 */
export type AgentConnection = 'bank' | 'skatteverket' | 'peppol' | 'mail' | 'browser'

export interface AgentDefinition {
  /** The colleague the user meets: a first name (same in every language) and a face. The role is a UI string. */
  persona: { name: string; avatar: string }
  knowledge: readonly string[]
  references: readonly string[]
  connections: readonly AgentConnection[]
  facts: readonly string[]
  agreements: boolean
}

const COMPLIANCE = 'horizontal/swedish-accounting-compliance'
const VAT = 'horizontal/swedish-vat'
const INVOICE = 'horizontal/swedish-invoice-compliance'
const YEAR_END = 'horizontal/swedish-year-end-closing'

export const AGENTS: Record<RegistrySkillId, AgentDefinition> = {
  bookkeep: {
    persona: { name: 'Vera', avatar: '/agent-avatars/agent-vera-bokforare.svg' },
    knowledge: [COMPLIANCE, VAT],
    references: [`${COMPLIANCE}/bas-kontoplan`, `${VAT}/vat-compliance-reference`, 'horizontal/swedish-asset-accounting/accounts-and-registry'],
    connections: ['bank', 'mail'],
    facts: ['accounting_method', 'vat_registered', 'vat_method', 'business_description', 'sni_codes', 'top_counterparty', 'monthly_cost_baseline'],
    agreements: true,
  },
  kvittojakten: {
    persona: { name: 'Sixten', avatar: '/agent-avatars/agent-sixten-kvitton.svg' },
    knowledge: [COMPLIANCE, INVOICE],
    references: [`${COMPLIANCE}/bfl-bfnar`, `${INVOICE}/invoice-rules`],
    connections: ['mail', 'browser'],
    facts: ['business_description', 'top_counterparty'],
    agreements: false,
  },
  'reconcile-month': {
    persona: { name: 'Ines', avatar: '/agent-avatars/agent-ines-avstamning.svg' },
    knowledge: [COMPLIANCE],
    references: [`${COMPLIANCE}/bas-kontoplan`, `${COMPLIANCE}/skatteverket`],
    connections: ['bank', 'skatteverket'],
    facts: ['bank_connection', 'loan_balance', 'monthly_cost_baseline'],
    agreements: true,
  },
  'month-end-close': {
    persona: { name: 'Oskar', avatar: '/agent-avatars/agent-oskar-manad.svg' },
    knowledge: [COMPLIANCE, VAT],
    references: [`${COMPLIANCE}/bfl-bfnar`, `${VAT}/vat-compliance-reference`],
    connections: ['bank', 'skatteverket'],
    facts: ['accounting_method', 'vat_period', 'vat_method', 'fiscal_year', 'bank_connection', 'monthly_cost_baseline'],
    agreements: true,
  },
  'quarterly-vat-review': {
    persona: { name: 'Mona', avatar: '/agent-avatars/agent-mona-moms.svg' },
    knowledge: [VAT, COMPLIANCE],
    references: [`${VAT}/vat-compliance-reference`, `${COMPLIANCE}/skatteverket`],
    connections: ['skatteverket'],
    facts: ['vat_registered', 'vat_period', 'vat_method', 'accounting_method', 'f_skatt', 'sni_codes'],
    agreements: false,
  },
  'payroll-monthly': {
    persona: { name: 'Leo', avatar: '/agent-avatars/agent-leo-lon.svg' },
    knowledge: ['horizontal/swedish-payroll'],
    references: ['agi-filing', 'tax-tables', 'social-charges', 'vacation-pay', 'sick-pay', 'benefits', 'bas-7xxx'].map((r) => `horizontal/swedish-payroll/${r}`),
    connections: ['skatteverket', 'bank'],
    facts: ['employer_registered', 'employee_count', 'employee_range_registry', 'monthly_salary_cost', 'beneficial_owners'],
    agreements: false,
  },
  'invoicing-rules': {
    persona: { name: 'Frida', avatar: '/agent-avatars/agent-frida-faktura.svg' },
    knowledge: [INVOICE, VAT],
    references: [`${INVOICE}/invoice-rules`, 'horizontal/swedish-e-invoicing/swedish-cius-and-specifics', 'horizontal/swedish-e-invoicing/consumer-and-b2c'],
    connections: ['peppol', 'mail'],
    facts: ['legal_name', 'org_number', 'registered_office', 'f_skatt', 'vat_registered', 'sni_codes'],
    agreements: false,
  },
  'kreditfaktura-process': {
    persona: { name: 'Nils', avatar: '/agent-avatars/agent-nils-kredit.svg' },
    knowledge: [INVOICE, VAT],
    references: [`${INVOICE}/invoice-rules`],
    connections: ['peppol'],
    facts: ['vat_registered', 'accounting_method'],
    agreements: false,
  },
  'year-end-close': {
    persona: { name: 'Astrid', avatar: '/agent-avatars/agent-astrid-bokslut.svg' },
    knowledge: [YEAR_END, 'horizontal/swedish-asset-accounting', 'horizontal/swedish-financial-reporting'],
    references: [
      `${YEAR_END}/closing-process`, `${YEAR_END}/journal-entries`, `${YEAR_END}/k2-vs-k3`, `${YEAR_END}/tax-calculations`,
      'horizontal/swedish-asset-accounting/depreciation', 'horizontal/swedish-financial-reporting/ink2-form-logic', 'horizontal/swedish-sru-filing/sru-codes',
    ],
    connections: ['skatteverket'],
    facts: ['fiscal_year', 'accounting_method', 'share_capital', 'share_count', 'board', 'signatories_rule', 'auditor', 'loan_balance', 'revenue_12m', 'employee_range_registry'],
    agreements: true,
  },
  'tax-planning': {
    persona: { name: 'Hugo', avatar: '/agent-avatars/agent-hugo-skatt.svg' },
    knowledge: ['horizontal/swedish-tax-planning', YEAR_END],
    references: ['312-regler', 'periodiseringsfond', 'overavskrivningar', 'strategy-and-interactions'].map((r) => `horizontal/swedish-tax-planning/${r}`)
      .concat('horizontal/swedish-payroll/social-charges'),
    connections: [],
    facts: ['fiscal_year', 'share_capital', 'share_count', 'beneficial_owners', 'board', 'revenue_12m', 'monthly_salary_cost', 'loan_balance'],
    agreements: true,
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

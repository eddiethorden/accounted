import { describe, it, expect } from 'vitest'
import { companyFactsFrom, periodStart, type CompanyFactInputs, type LedgerLine } from '../derive-company'
import { PREDICATES } from '../predicates'

const line = (account_number: string, entry_date: string, debit = 0, credit = 0): LedgerLine => ({ account_number, entry_date, debit, credit })

function inputs(over: Partial<CompanyFactInputs> = {}): CompanyFactInputs {
  return {
    today: '2026-09-22',
    lines: [],
    accountName: (a) => ({ '5420': 'Programvaror', '7210': 'Löner till tjänstemän' })[a] ?? null,
    activeEmployees: null,
    accountingMethod: null,
    fiscalYearStartMonth: null,
    tic: null,
    bankConnections: [],
    counterparties: [],
    heldByHigherTrust: new Set(),
    ...over,
  }
}

const by = (drafts: ReturnType<typeof companyFactsFrom>, predicate: string) => drafts.filter((d) => d.predicate === predicate)

describe('companyFactsFrom', () => {
  it('every predicate it writes is in the vocabulary, on the company, with the right cardinality', () => {
    const drafts = companyFactsFrom(
      inputs({
        lines: [line('7210', '2026-07-25', 70000), line('7210', '2026-08-25', 70000), line('3010', '2026-08-01', 0, 100000), line('2359', '2026-02-02', 0, 500000), line('5420', '2026-06-01', 30000), line('5420', '2026-07-01', 20000), line('5420', '2026-08-01', 50000)],
        activeEmployees: 2,
        accountingMethod: 'accrual',
        fiscalYearStartMonth: 1,
        tic: { sniCodes: [{ code: '62010', name: 'Dataprogrammering' }], beneficialOwners: [{ name: 'Jakob Wennberg', extentDescription: '100 %' }], employeeRange: 'Inga anställda' },
        bankConnections: [{ bank_name: 'Swedbank', created_at: '2026-02-01T10:00:00Z' }],
        counterparties: [{ name: 'Almi', flow: 60000 }],
      }),
    )
    expect(drafts.length).toBeGreaterThan(8)
    for (const d of drafts) {
      const def = PREDICATES[d.predicate]
      expect(def, d.predicate).toBeDefined()
      expect(def.subject).toBe('company')
      expect(def.singleValued, d.predicate).toBe(d.singleValued)
    }
  })

  it('averages salary over the months that had any, nets revenue, and reads the loan balance from every posting', () => {
    const drafts = companyFactsFrom(
      inputs({
        lines: [
          line('7210', '2026-07-25', 50000),
          line('7210', '2026-08-25', 70000),
          line('7290', '2026-08-25', 8400),
          line('3010', '2026-08-01', 0, 100000),
          line('3010', '2026-08-15', 20000), // a credit note
          line('2359', '2025-02-02', 0, 500000), // paid out before the period: still a loan
          line('2359', '2026-03-31', 10417), // one amortisation
        ],
      }),
    )
    expect(by(drafts, 'monthly_salary_cost')[0]).toMatchObject({ value: 64200, valueText: '64 200 kr/mån (2 mån med lön)', sourceKind: 'ledger' })
    expect(by(drafts, 'revenue_12m')[0]).toMatchObject({ value: 80000 })
    expect(by(drafts, 'loan_balance')[0]).toMatchObject({ value: 489583, valueText: '489 583 kr (2359)' })
  })

  it('writes a baseline only for accounts with three months of cost, with the typical month and its range', () => {
    const drafts = companyFactsFrom(
      inputs({
        lines: [line('5420', '2026-06-01', 30000), line('5420', '2026-06-15', 5000), line('5420', '2026-07-01', 20000), line('5420', '2026-08-01', 50000), line('6570', '2026-08-01', 140), line('6570', '2026-09-01', 140)],
      }),
    )
    const baselines = by(drafts, 'monthly_cost_baseline')
    expect(baselines).toHaveLength(1)
    expect(baselines[0].value).toEqual({ account: '5420', name: 'Programvaror', median: 35000, low: 20000, high: 50000, months: 3 })
    expect(baselines[0].valueText).toBe('5420 Programvaror: typiskt 35 000 kr/mån (20 000 kr till 50 000 kr, 3 mån)')
  })

  it('keeps the five biggest counterparties by flow, in order', () => {
    const counterparties = ['A', 'B', 'C', 'D', 'E', 'F'].map((name, i) => ({ name, flow: (i + 1) * 1000 }))
    const top = by(companyFactsFrom(inputs({ counterparties })), 'top_counterparty')
    expect(top.map((d) => (d.value as { name: string }).name)).toEqual(['F', 'E', 'D', 'C', 'B'])
    expect(top[0].valueText).toBe('F: 6 000 kr (12 mån)')
  })

  it('leaves fiscal_year and board to a document or a person when they hold it, and says where a registry value comes from', () => {
    const held = companyFactsFrom(inputs({ fiscalYearStartMonth: 1, accountingMethod: 'cash', heldByHigherTrust: new Set(['fiscal_year']) }))
    expect(by(held, 'fiscal_year')).toEqual([])
    expect(by(held, 'accounting_method')[0].valueText).toBe('Bokslutsmetoden (kontantmetoden), enligt inställningarna')
    const free = companyFactsFrom(inputs({ fiscalYearStartMonth: 7 }))
    expect(by(free, 'fiscal_year')[0]).toMatchObject({ value: '0701 - 0630', sourceKind: 'registry' })
  })

  it('reads industry, owners and the registry employee range from the Bolagsverket snapshot', () => {
    const drafts = companyFactsFrom(inputs({ tic: { sniCodes: [{ code: '62010', name: 'Dataprogrammering' }, { code: '64920', name: 'Annan kreditgivning' }], beneficialOwners: [{ name: 'Jakob Wennberg', extentDescription: '100 %' }], employeeRange: 'Inga anställda' } }))
    expect(by(drafts, 'sni_codes')[0].valueText).toBe('62010 Dataprogrammering; 64920 Annan kreditgivning')
    expect(by(drafts, 'beneficial_owners')[0].valueText).toBe('Jakob Wennberg (100 %)')
    expect(by(drafts, 'employee_range_registry')[0].valueText).toBe('Inga anställda (enligt registret)')
  })

  it('writes nothing from an empty company', () => {
    expect(companyFactsFrom(inputs())).toEqual([])
    expect(periodStart('2026-09-22')).toBe('2025-09-22')
  })
})

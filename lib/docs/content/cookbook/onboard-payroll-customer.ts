export const COOKBOOK_ONBOARD_PAYROLL_MD = `# Cookbook: onboard a payroll customer and run the first month

> For payroll operators and bureaus that run many companies over the API: provision a company, set its payroll settings, load employees and their cutover balances, feed the month's deviations, run payroll, pay it, book it, file the AGI. Everything here is API-callable; nothing requires the dashboard.

This is the operator-side companion to [Run payroll and generate the AGI XML](/docs/api/cookbook/run-payroll-and-agi), which walks the run state machine in detail. Here the focus is the setup you do once per customer and the inputs you push every month.

## What you'll need

- A **live** API key with \`companies:write\`, \`payroll:read\` and \`payroll:write\`. One key covers every company its user belongs to: a company you create with the key is immediately accessible with the same key.
- \`Idempotency-Key\` on every mutating call (\`uuidgen\` is fine). Retries replay the original response with \`Idempotent-Replayed: true\`.
- \`?dry_run=true\` on anything you are unsure about: the request is validated and previewed, nothing is written.

## 1. Create the company

\`\`\`bash
curl "https://app.gnubok.se/api/v1/companies" \\
  -H "Authorization: Bearer gnubok_sk_..." \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "Ingager AB", "entity_type": "aktiebolag", "org_number": "5566778899", "vat_registered": true, "moms_period": "monthly", "accounting_method": "accrual", "f_skatt": true }'
\`\`\`

The response carries the \`id\` you use as \`$COMPANY_ID\` from here on. The BAS chart of accounts is seeded on creation; the fiscal year follows \`fiscal_year_start_month\` (default January). Bank details for the payment file (IBAN + BIC for pain.001, bankgiro for Bankgirot LB) go on \`PATCH /companies/{id}/settings\`.

## 2. Payroll settings, once, before the first run

\`\`\`bash
curl -X PATCH "https://app.gnubok.se/api/v1/companies/$COMPANY_ID/salary/settings" \\
  -H "Authorization: Bearer gnubok_sk_..." \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{
    "salary_pay_day": 25,
    "salary_deviation_period": "previous_month",
    "preferred_payment_format": "pain001",
    "salary_default_bank": "seb",
    "salary_net_rounding": false,
    "salary_voucher_series": "L"
  }'
\`\`\`

- \`salary_deviation_period\` is the avvikelseperiod: \`previous_month\` means a run for September reads August's absence, sick days, VAB and worked hours (the standard "innevarande månads lön, föregående månads avvikelser"). \`same_month\` reads September. The window is snapshotted on each run at creation, so decide this before the first run: switching later makes the next run's window overlap the previous run and it is refused with \`409 SALARY_RUN_DEVIATION_PERIOD_OVERLAP\`.
- \`salary_pay_day\` only sets the default \`payment_date\` of new runs.
- \`salary_voucher_series\` is the verifikationsserie salary vouchers book under. A fresh company defaults to K; send the letter explicitly when provisioning so it is never a surprise.

Read it back with \`GET /salary/settings\`. There is no separate "avtal" to configure: statutory parameters (arbetsgivaravgifter, traktamenten, karens, sjuklön) live centrally per year and are maintained by Accounted.

## 3. Employees

\`\`\`bash
curl "https://app.gnubok.se/api/v1/companies/$COMPANY_ID/employees" \\
  -H "Authorization: Bearer gnubok_sk_..." \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{
    "first_name": "Anna", "last_name": "Andersson", "personnummer": "YYYYMMDDNNNN",
    "employment_type": "employee", "employment_start": "2024-01-15",
    "salary_type": "monthly", "monthly_salary": 35000, "employment_degree": 100,
    "workdays_per_week": 5,
    "tax_table_number": 33, "tax_column": 1, "f_skatt_status": "a_skatt",
    "vacation_rule": "sammalone", "vacation_days_per_year": 25, "semestertillagg_rate": 0.0043,
    "clearing_number": "5000", "bank_account_number": "1234567890",
    "email": "anna@example.se"
  }'
\`\`\`

Hourly staff: \`"salary_type": "hourly", "hourly_rate": 210\` and no \`monthly_salary\`; their gross derives from the worked days you register in step 5. Jämkning (\`jamkning_percentage\` with \`valid_from\` and \`valid_to\`), växa-stöd and part-time schedules (\`workdays_per_week\`) are fields on the same record. \`personnummer\` is masked on the list, full on the detail endpoint.

## 4. Cutover balances (only when you take over mid-year)

\`\`\`bash
curl -X PUT "https://app.gnubok.se/api/v1/companies/$COMPANY_ID/employees/$EMPLOYEE_ID/opening-balances" \\
  -H "Authorization: Bearer gnubok_sk_..." \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{
    "cutover_date": "2026-09-01",
    "ytd_gross": 280000, "ytd_tax": 64000, "ytd_net": 216000,
    "vacation_paid_days_remaining": 12.5,
    "vacation_saved_days_by_year": { "2025": 5 },
    "opening_semester_liability": 42000,
    "opening_semester_liability_avgifter": 13196.4,
    "karens_periods_adjustment": 1
  }'
\`\`\`

\`karens_periods_adjustment\` is the number of sjuklöneperioder in the 12 months before cutover that the previous system handled, so the högriskskydd cap (10 karensavdrag per rolling 12 months) carries over. A pågående sjukfall is registered as ordinary absence days on their real dates (step 5): the engine merges them into the running sjuklöneperiod. \`PUT /employees/{employeeId}/opening-balances\` sets one employee; \`PUT /employees/opening-balances\` (no employee id) takes the whole roster in one call. The balances lock when the first run books.

## 5. Monthly inputs

Register deviations on the dates they happened. The run reads them from its avvikelseperiod, not from the day you registered them.

**Absence** (sick, vab, parental, unpaid leave and so on), weekends skipped unless \`include_weekends\`:

\`\`\`bash
curl -X PUT "https://app.gnubok.se/api/v1/companies/$COMPANY_ID/employees/$EMPLOYEE_ID/absence" \\
  -H "Authorization: Bearer gnubok_sk_..." -H "Content-Type: application/json" \\
  -d '{ "from": "2026-08-10", "to": "2026-08-12", "absence_type": "sick" }'
\`\`\`

Karensavdrag, sjuklön dag 2-14, day 15+ (Försäkringskassan), återinsjuknande and högriskskydd are derived from the dates; nothing to configure.

**Worked days** for hourly staff, and for OB/shift premiums on anyone:

\`\`\`bash
curl -X PUT "https://app.gnubok.se/api/v1/companies/$COMPANY_ID/employees/$EMPLOYEE_ID/worked-days" \\
  -H "Authorization: Bearer gnubok_sk_..." -H "Content-Type: application/json" \\
  -d '{ "days": [
    { "work_date": "2026-08-03", "hours": 8, "start_time": "07:00", "end_time": "15:30" },
    { "work_date": "2026-08-04", "hours": 6.5, "start_time": "16:00", "end_time": "22:30" }
  ] }'
\`\`\`

**Standing rows and benefits** live on the employee and are re-derived on every run whose payment date falls inside their validity:

\`\`\`bash
# A monthly allowance that recurs until further notice
curl "https://app.gnubok.se/api/v1/companies/$COMPANY_ID/employees/$EMPLOYEE_ID/recurring-lines" \\
  -H "Authorization: Bearer gnubok_sk_..." -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \\
  -d '{ "item_type": "allowance", "description": "Friskvårdsbidrag", "amount": 416.67, "valid_from": "2026-09-01" }'

# Bilförmån at the Skatteverket schablon value
curl "https://app.gnubok.se/api/v1/companies/$COMPANY_ID/employees/$EMPLOYEE_ID/benefits" \\
  -H "Authorization: Bearer gnubok_sk_..." -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \\
  -d '{ "benefit_type": "car", "description": "Volvo XC40 2025", "monthly_value": 4210, "valid_from": "2026-09-01" }'
\`\`\`

Deductions carry a negative amount and the API rejects the wrong sign for the item type. The förmånsvärde is added to the tax and avgifter basis at \`:calculate\`; supply the schablon figure, the API does not compute it from the car.

**One-off lines** (bonus, deduction, reimbursement) go on the run itself once it exists: \`POST /salary-runs/{id}/employees/{employeeId}/lines\`. A different base salary for one month: \`PATCH /salary-runs/{id}/employees/{employeeId}\` with \`monthly_salary\`.

## 6. Run payroll

\`\`\`bash
curl "https://app.gnubok.se/api/v1/companies/$COMPANY_ID/salary-runs" \\
  -H "Authorization: Bearer gnubok_sk_..." -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \\
  -d '{ "period_year": 2026, "period_month": 9, "payment_date": "2026-09-25", "voucher_series": "L" }'
\`\`\`

The response echoes \`deviation_period_start\` / \`deviation_period_end\` (here 2026-08-01 to 2026-08-31 under \`previous_month\`). Pass both explicitly to override for one run. Then attach the roster (\`POST /salary-runs/{id}/employees\` per employee), \`POST /salary-runs/{id}/calculate\`, read each payslip with its step-by-step breakdown (\`GET /salary-runs/{id}/employees/{employeeId}\`), and \`POST /salary-runs/{id}/approve\`. The calculate response carries non-blocking warnings (läkarintyg expected, Försäkringskassan reporting, F-skatt not verified) that an operator should surface to the customer.

## 7. Pay

\`\`\`bash
curl "https://app.gnubok.se/api/v1/companies/$COMPANY_ID/salary-runs/$RUN_ID/payment-file" \\
  -H "Authorization: Bearer gnubok_sk_..." -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \\
  -d '{ "format": "pain001" }'
\`\`\`

The file comes back inline as \`data.content\` with \`data.filename\`; write it to disk and upload it in the bank's file channel (pain.001 usually needs a filkommunikationsavtal, not the ordinary web upload). Generating the file does not change the run's state. When the bank has executed, \`POST /salary-runs/{id}/mark-paid\`.

## 8. Book and file

\`POST /salary-runs/{id}/book\` posts the verifikat (gross, tax, net, avgifter, vacation accrual) under the run's voucher series, and \`POST /salary-runs/{id}/generate-agi\` returns the arbetsgivardeklaration XML for the payout month. Uploading the AGI to Skatteverket requires BankID signing by the company's ombud; that is deliberate. Subscribe to \`salary_run.approved\`, \`salary_run.booked\` and \`agi.generated\` via [webhooks](/docs/api/cookbook/webhooks) to drive your own workflow.

A booked month that turns out wrong is corrected with \`POST /salary-runs/{id}/correct\`: the run's verifikat are reversed by storno (BFL 5 kap 5 §, nothing is edited or deleted), the original is marked \`corrected\`, and a fresh draft for the same period is returned as \`correction_run\`. Attach, calculate, approve, pay and book it like any run, then regenerate the AGI for the period. Dates inside a calculated, approved, paid or booked run's avvikelseperiod are locked for absence and worked-days writes (\`409 SALARY_REGISTER_DATES_LOCKED_BY_RUN\`); register the days once the correction run exists.

## 9. Year end

\`POST /salary/vacation-year-close\` runs the semesterårsavslut (beredning + commit) and \`GET /reports/vacation-liability\` gives the semesterskuld per employee at any time. \`GET /reports/salary-journal\` is the lönejournal for the customer's accountant.

## Pitfalls

- **Settings before runs.** \`salary_deviation_period\` and \`salary_voucher_series\` are copied onto each run when it is created. Set them in step 2, not after the first run exists.
- **Dates, not months.** Absence and worked days are per calendar day. A sick period that spans a month boundary is registered as one range; each run takes the days inside its own window.
- **Hourly staff without worked days calculate to zero.** Register the days before \`:calculate\`, or set \`hours_worked\` when attaching the employee to the run if you only have a total.
- **Payment file is not payment.** \`:mark-paid\` is your confirmation that the bank executed; the AGI period follows the payout month.
- **Test keys never write.** A \`gnubok_sk_test_*\` key forces every mutation into dry-run mode, so a test key cannot create a company or a run. Use it to validate payloads, then switch to the live key.
`

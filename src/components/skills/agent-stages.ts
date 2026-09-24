import type { RegistrySkillId } from '@/lib/agent-skills/registry'

// Strata renders behind each agent (public/agenter/*.webp), made like the
// start cards (components/dashboard/startkort-assets.ts) with strata-engine in
// the CRM workspace: `node stratify.mjs <source> linen-clear --bg <ground>`.
// Sources and licences: public/agenter/CREDITS.md. The ground colour is baked
// into the render, so the stage background matches it and no seam shows.
// Intrinsic dimensions are declared so the <img> reserves its box.

export interface AgentStage { src: string; w: number; h: number; ground: string; position: string }

const stage = (file: string, w: number, h: number, ground: string, position = 'center 40%'): AgentStage =>
  ({ src: `/agenter/${file}.webp`, w, h, ground, position })

export const AGENT_STAGES: Record<RegistrySkillId, AgentStage> = {
  bookkeep: stage('bookkeep', 2400, 3062, '#1F2B20', 'center 30%'),
  kvittojakten: stage('kvittojakten', 2400, 1600, '#3A2118'),
  'reconcile-month': stage('reconcile-month', 2400, 3200, '#1B2136', 'center 45%'),
  'month-end-close': stage('month-end-close', 2400, 3602, '#16303B', 'center 35%'),
  'quarterly-vat-review': stage('quarterly-vat-review', 2400, 1600, '#2E3C58'),
  'payroll-monthly': stage('payroll-monthly', 2400, 2966, '#322416', 'center 45%'),
  'invoicing-rules': stage('invoicing-rules', 2400, 1600, '#2A2233'),
  'kreditfaktura-process': stage('kreditfaktura-process', 2400, 1460, '#1B2136'),
  'year-end-close': stage('year-end-close', 2400, 2000, '#322416', 'center 30%'),
  'tax-planning': stage('tax-planning', 2400, 1800, '#1F2B20'),
}

/** The company's own agents share one Stockholm stage. */
export const OWN_STAGE = stage('own', 2400, 1596, '#16303B')

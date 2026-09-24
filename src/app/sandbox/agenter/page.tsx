'use client'

/** Internal demo of the Agenter list with example data. Auth-free (/sandbox). */

import { SkillsPage } from '@/components/skills/SkillsPage'
import { SandboxShell } from './fixtures'

export default function AgenterSandboxPage() {
  return <SandboxShell><SkillsPage hrefBase="/sandbox/agenter" /></SandboxShell>
}

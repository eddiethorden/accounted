'use client'

/** Internal demo of one agent's page with example data. Auth-free (/sandbox). */

import { use } from 'react'
import { InstructionDetail } from '@/components/skills/InstructionDetail'
import { SandboxShell } from '../fixtures'

export default function AgentSandboxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <SandboxShell><InstructionDetail segment={id} backHref="/sandbox/agenter" /></SandboxShell>
}

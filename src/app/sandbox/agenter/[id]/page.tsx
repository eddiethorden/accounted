'use client'

/** Internal demo of one agent's page with example data. Auth-free (/sandbox). */

import { use } from 'react'
import { AgentDetail } from '@/components/skills/AgentDetail'
import { SandboxShell } from '../fixtures'

export default function AgentSandboxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <SandboxShell><AgentDetail segment={id} backHref="/sandbox/agenter" /></SandboxShell>
}

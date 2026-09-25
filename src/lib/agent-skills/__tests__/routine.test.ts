import { describe, expect, it } from 'vitest'
import { coworkLink, routinePrompt, routineTime } from '../routine'

describe('routine', () => {
  const wrap = (when: string, run: string) => `Skapa en schemalagd uppgift som körs ${when}. Varje gång den körs: ${run}`

  it('writes the request around the page\'s own start prompt', () => {
    expect(routinePrompt({ when: 'varje måndag kl 07:00', run: 'Hitta kvittona som saknas.', wrap }))
      .toBe('Skapa en schemalagd uppgift som körs varje måndag kl 07:00. Varje gång den körs: Hitta kvittona som saknas.')
  })

  it('never sends more than Cowork takes', () => {
    expect(routinePrompt({ when: 'varje dag', run: 'x'.repeat(20000), wrap }).length).toBe(14000)
  })

  it('opens a new Cowork task in Claude Desktop with the request encoded', () => {
    expect(coworkLink('Kör "bookkeep" & svara kort')).toBe('claude://cowork/new?q=K%C3%B6r%20%22bookkeep%22%20%26%20svara%20kort')
  })

  it('keeps a valid time and falls back otherwise', () => {
    expect(routineTime('18:30')).toBe('18:30')
    expect(routineTime('')).toBe('07:00')
    expect(routineTime('25:00')).toBe('07:00')
  })
})

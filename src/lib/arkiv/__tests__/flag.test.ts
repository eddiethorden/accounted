import { describe, it, expect, afterEach } from 'vitest'
import { arkivBrainRollout, isArkivBrainEnabled, isArkivEnabled } from '../flag'

const saved = { brain: process.env.ARKIV_BRAIN_COMPANY_IDS, old: process.env.ARKIV_COMPANY_IDS }

afterEach(() => {
  if (saved.brain === undefined) delete process.env.ARKIV_BRAIN_COMPANY_IDS
  else process.env.ARKIV_BRAIN_COMPANY_IDS = saved.brain
  if (saved.old === undefined) delete process.env.ARKIV_COMPANY_IDS
  else process.env.ARKIV_COMPANY_IDS = saved.old
})

describe('isArkivEnabled (the shelf)', () => {
  it('is on for every company and needs only a company id', () => {
    delete process.env.ARKIV_BRAIN_COMPANY_IDS
    delete process.env.ARKIV_COMPANY_IDS
    expect(isArkivEnabled('co-1')).toBe(true)
    expect(isArkivEnabled('anyone')).toBe(true)
    expect(isArkivEnabled(null)).toBe(false)
    expect(isArkivEnabled('')).toBe(false)
  })
})

describe('arkivBrainRollout', () => {
  it('is nobody when unset, everyone for *, and the listed ids otherwise', () => {
    delete process.env.ARKIV_BRAIN_COMPANY_IDS
    expect(arkivBrainRollout()).toEqual([])
    process.env.ARKIV_BRAIN_COMPANY_IDS = '*'
    expect(arkivBrainRollout()).toBe('all')
    process.env.ARKIV_BRAIN_COMPANY_IDS = ' co-1, ,co-2 '
    expect(arkivBrainRollout()).toEqual(['co-1', 'co-2'])
    process.env.ARKIV_BRAIN_COMPANY_IDS = 'co-1,co-2,co-1'
    expect(arkivBrainRollout()).toEqual(['co-1', 'co-2'])
  })

  it('no longer reads the pilot flag', () => {
    delete process.env.ARKIV_BRAIN_COMPANY_IDS
    process.env.ARKIV_COMPANY_IDS = 'co-1'
    expect(arkivBrainRollout()).toEqual([])
    expect(isArkivBrainEnabled('co-1')).toBe(false)
  })
})

describe('isArkivBrainEnabled', () => {
  it('is off for everyone when unset', () => {
    delete process.env.ARKIV_BRAIN_COMPANY_IDS
    expect(isArkivBrainEnabled('co-1')).toBe(false)
  })

  it('lists companies, tolerates spaces, and * means everyone', () => {
    process.env.ARKIV_BRAIN_COMPANY_IDS = ' co-1, co-2 '
    expect(isArkivBrainEnabled('co-1')).toBe(true)
    expect(isArkivBrainEnabled('co-3')).toBe(false)
    expect(isArkivBrainEnabled(null)).toBe(false)
    process.env.ARKIV_BRAIN_COMPANY_IDS = '*'
    expect(isArkivBrainEnabled('anyone')).toBe(true)
  })
})

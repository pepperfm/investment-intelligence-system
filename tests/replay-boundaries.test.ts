import { describe, expect, it } from 'vitest'
import { retrospectiveRef } from '../server/domain/memory/selection'
import { scenarioDeadline } from '../server/domain/market/scenario-deadline'
import { staleDays } from '../server/domain/market/calendar'

const h = '00000000-0000-4000-8000-000000000001'
const revision = '00000000-0000-4000-8000-000000000002'

describe('replay integration boundaries', () => {
  it('keeps the hypothesis UUID separate from a versioned retrospective reference', () => {
    expect(retrospectiveRef(`retro:${h}`)).toEqual({
      hypothesisId: h,
      revisionId: null,
    })
    expect(retrospectiveRef(`retro:${h}:${revision}:review-id`)).toEqual({
      hypothesisId: h,
      revisionId: revision,
    })
    expect(retrospectiveRef('retro:not-a-uuid')).toBeNull()
  })
  it('counts entry as the first held bar and uses no spare entry days for next-open', () => {
    const signal = new Date('2026-09-25T20:59:59Z')
    const entry = {
      type: 'market_next_open' as const,
      price: 100,
      validDays: 3,
      note: '',
    }
    const exit = {
      stopLoss: 95,
      takeProfit: 110,
      timeExitDays: 10,
      note: '',
    }
    expect(scenarioDeadline(signal, entry, exit, { provider: 'mock' }).toISOString().slice(0, 10)).toBe('2026-10-09')
    expect(scenarioDeadline(signal, {
      ...entry,
      type: 'limit',
    }, exit, { provider: 'mock' }).toISOString().slice(0, 10)).toBe('2026-10-13')
  })
  it('keeps the explicit mock calendar usable outside the verified MOEX year', () => {
    expect(staleDays('2025-09-25', new Date('2025-09-26'), { provider: 'mock' })).toBe(1)
    expect(staleDays('2025-09-25', new Date('2025-09-26'), { provider: 'finam' })).toBe(Infinity)
  })
})

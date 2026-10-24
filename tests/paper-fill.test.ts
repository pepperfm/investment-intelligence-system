import { describe, expect, it } from 'vitest'
import { paperFill } from '../server/domain/risk/paper-fill'

const costs = {
  commissionPct: 0,
  slippagePct: 0.1,
  spreadPct: 0.2,
}
const order = {
  side: 'buy' as const,
  type: 'market' as const,
  limitPrice: null,
  confirmedAt: new Date('2026-10-20T12:00:00Z'),
}
const bar = {
  ts: '2026-10-21T00:00:00Z',
  open: 100,
  high: 110,
  low: 90,
  close: 105,
  volume: 1000,
}

describe('daily paper fills', () => {
  it('waits for a bar after confirmation instead of filling at an old close', () => {
    expect(paperFill(order, [{
      ...bar,
      ts: '2026-10-20T00:00:00Z',
    }], costs)).toBeNull()
    expect(paperFill(order, [{
      ...bar,
      ts: order.confirmedAt.toISOString(),
    }], costs)).toBeNull()
  })
  it('fills at the first future open with side-dependent costs', () => {
    expect(paperFill(order, [bar], costs)?.price).toBeCloseTo(100.2)
    expect(paperFill({
      ...order,
      side: 'sell',
    }, [bar], costs)?.price).toBeCloseTo(99.8)
    expect(paperFill(order, [bar], costs)?.executedAt.toISOString()).toBe(new Date(bar.ts).toISOString())
  })
  it('fills a future limit at its price or a better opening gap, never at stale prices', () => {
    const limit = {
      ...order,
      type: 'limit' as const,
      limitPrice: 95,
    }
    expect(paperFill(limit, [bar], costs)?.price).toBe(95)
    expect(paperFill(limit, [{
      ...bar,
      open: 92,
    }], costs)?.price).toBe(92)
    expect(paperFill(limit, [{
      ...bar,
      low: 96,
    }], costs)).toBeNull()
    expect(paperFill(limit, [{
      ...bar,
      ts: '2026-10-19T00:00:00Z',
    }], costs)).toBeNull()
  })
})

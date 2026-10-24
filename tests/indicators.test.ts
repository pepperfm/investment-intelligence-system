import { describe, expect, it } from 'vitest'
import { atr, computeMetrics, maxDrawdown, momentum, rsi, sma } from '../server/domain/market/indicators'
import { addTradingDays, staleDays } from '../server/domain/market/calendar'
import type { Candle } from '../shared/types/investment'

function candles(closes: number[]): Candle[] {
  return closes.map((c, i) => ({
    ts: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
    open: c,
    high: c + 1,
    low: c - 1,
    close: c,
    volume: 1000,
  }))
}

describe('indicators', () => {
  it('computes SMA and returns null on short history', () => {
    expect(sma([1, 2, 3, 4], 2)).toBe(3.5)
    expect(sma([1], 2)).toBeNull()
  })
  it('RSI is 100 on monotonic gains and ~50 on alternation', () => {
    expect(rsi(Array.from({ length: 30 }, (_, i) => i + 1))).toBe(100)
    const alt = Array.from({ length: 60 }, (_, i) => 100 + (i % 2))
    expect(rsi(alt)).toBeGreaterThan(40)
    expect(rsi(alt)).toBeLessThan(60)
  })
  it('ATR of constant-range bars equals the range', () => {
    expect(atr(candles(Array.from({ length: 30 }, () => 100)), 14)).toBeCloseTo(2)
  })
  it('momentum and drawdown', () => {
    expect(momentum([100, 110, 121], 2)).toBeCloseTo(0.21)
    expect(maxDrawdown([100, 120, 90, 130])).toBeCloseTo(-0.25)
  })
  it('computeMetrics reports bars and liquidity', () => {
    const m = computeMetrics(candles(Array.from({ length: 250 }, (_, i) => 100 + i * 0.1)))
    expect(m.bars).toBe(250)
    expect(m.sma200).not.toBeNull()
    expect(m.avgTurnover20).toBeGreaterThan(0)
  })
})

describe('calendar', () => {
  it('skips weekends', () => {
    const friday = new Date(Date.UTC(2026, 9, 23))
    expect(addTradingDays(friday, 1).getUTCDay()).toBe(1)
  })
  it('staleness is infinite without data', () => {
    expect(staleDays(undefined, new Date())).toBe(Infinity)
  })
})

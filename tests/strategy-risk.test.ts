import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES, evaluateSignal } from '../server/domain/strategies/rules'
import { DEFAULT_COSTS, DEFAULT_RISK_LIMITS, checkOrderRisk, suggestQuantity, type PortfolioState } from '../server/domain/risk/limits'
import type { Candle } from '../shared/types/investment'

function trend(n: number, slope: number, volume = 1_000_000): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const c = 100 * (1 + slope) ** i * (1 + 0.01 * Math.sin(i / 3))
    return {
      ts: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
      open: c,
      high: c * 1.01,
      low: c * 0.99,
      close: c,
      volume,
    }
  })
}

describe('strategy signals', () => {
  it('position strategy finds a trend setup in a steady uptrend', () => {
    const signal = evaluateSignal('position', {
      ...DEFAULT_RULES.position,
      rsiMax: 100,
    }, trend(300, 0.002))
    expect(signal.setupType).toBe('trend')
    expect(signal.stopLoss!).toBeLessThan(signal.entry!)
    expect(signal.takeProfit!).toBeGreaterThan(signal.entry!)
  })
  it('rejects a downtrend and illiquid names', () => {
    const down = evaluateSignal('swing', DEFAULT_RULES.swing, trend(300, -0.002))
    expect(down.setup).toBe(false)
    const illiquid = evaluateSignal('position', DEFAULT_RULES.position, trend(300, 0.002, 1))
    expect(illiquid.failures.some(f => f.includes('Ликвидность'))).toBe(true)
  })
  it('allowPullback=false leaves only breakouts', () => {
    const flat = trend(300, 0.0015)
    const withPullback = evaluateSignal('swing', DEFAULT_RULES.swing, flat)
    const breakoutOnly = evaluateSignal('swing', {
      ...DEFAULT_RULES.swing,
      allowPullback: false,
    }, flat)
    if (withPullback.setupType === 'pullback') {
      expect(breakoutOnly.setup).toBe(false)
      expect(breakoutOnly.failures.join(' ')).toMatch(/откат/)
    }
    expect(['breakout', 'none']).toContain(breakoutOnly.setupType)
  })
  it('minRewardRisk is versioned: 1:1 levels fail the default 1.2 but pass an explicit 1.0', () => {
    const candles = trend(300, 0.002)
    const rules = {
      ...DEFAULT_RULES.position,
      rsiMax: 100,
      targetAtr: 2,
      stopAtr: 2,
    }
    const { minRewardRisk: _default, ...legacy } = rules
    const rejected = evaluateSignal('position', legacy, candles)
    expect(rejected.rewardRisk).toBe(1)
    expect(rejected.setup).toBe(false)
    expect(rejected.failures.join(' ')).toMatch(/Прибыль\/риск/)
    expect(evaluateSignal('position', {
      ...rules,
      minRewardRisk: 1,
    }, candles).setup).toBe(true)
  })
  it('regime filter blocks setups when the index is below its SMA and ignores future index bars', () => {
    const candles = trend(300, 0.002)
    const rules = {
      ...DEFAULT_RULES.position,
      rsiMax: 100,
      regimeSma: 50,
    }
    const up = trend(300, 0.001)
    const down = trend(300, -0.002)
    expect(evaluateSignal('position', rules, candles, up).setup).toBe(true)
    const blocked = evaluateSignal('position', rules, candles, down)
    expect(blocked.setup).toBe(false)
    expect(blocked.failures.join(' ')).toMatch(/Рыночный режим/)
    expect(evaluateSignal('position', rules, candles, []).failures.join(' ')).toMatch(/Нет данных индекса/)
    // Index crash dated after the instrument's last bar must not affect the signal.
    const lastTs = candles.at(-1)!.ts
    const withFutureCrash = up.concat(Array.from({ length: 60 }, (_, i) => ({
      ts: new Date(new Date(lastTs).getTime() + (i + 1) * 86_400_000).toISOString(),
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
    })))
    expect(evaluateSignal('position', rules, candles, withFutureCrash).setup).toBe(true)
    expect(evaluateSignal('position', {
      ...rules,
      regimeSma: 0,
    }, candles, down).setup).toBe(true)
  })
  it('reports insufficient history', () => {
    expect(evaluateSignal('swing', DEFAULT_RULES.swing, trend(5, 0)).setup).toBe(false)
  })
})

const portfolio = (overrides: Partial<PortfolioState> = {}): PortfolioState => ({
  equity: 1_000_000,
  cash: 1_000_000,
  positions: {},
  dayStartEquity: null,
  ...overrides,
})

describe('risk limits', () => {
  const base = {
    side: 'buy' as const,
    instrumentId: 'a',
    sector: 'energy',
    lotSize: 1,
    stopLoss: 95,
    avgTurnover: 1e9,
    limits: DEFAULT_RISK_LIMITS,
    costs: DEFAULT_COSTS,
  }
  it('sizes by per-trade risk', () => {
    const qty = suggestQuantity({
      equity: 1_000_000,
      entry: 100,
      stopLoss: 95,
      lotSize: 10,
      avgTurnover: 1e9,
      limits: DEFAULT_RISK_LIMITS,
    })
    // 1% risk = 10 000 ₽ / 5 ₽ = 2000 shares, but 10% position cap = 1000 shares.
    expect(qty).toBe(1000)
  })
  it('accepts a compliant order', () => {
    expect(checkOrderRisk({
      ...base,
      quantity: 500,
      price: 100,
      portfolio: portfolio(),
    }).ok).toBe(true)
  })
  it('blocks oversize, leverage, sector concentration and short selling', () => {
    expect(checkOrderRisk({
      ...base,
      quantity: 5000,
      price: 100,
      portfolio: portfolio(),
    }).violations.length).toBeGreaterThan(0)
    expect(checkOrderRisk({
      ...base,
      quantity: 500,
      price: 100,
      portfolio: portfolio({ cash: 1000 }),
    }).violations.some(v => v.includes('плечо'))).toBe(true)
    expect(checkOrderRisk({
      ...base,
      quantity: 500,
      price: 100,
      portfolio: portfolio({
        positions: {
          b: {
            value: 280_000,
            sector: 'energy',
            quantity: 1,
          },
        },
      }),
    }).violations.some(v => v.includes('секторе'))).toBe(true)
    expect(checkOrderRisk({
      ...base,
      side: 'sell',
      quantity: 10,
      price: 100,
      portfolio: portfolio(),
    }).ok).toBe(false)
  })
  it('blocks buys after the daily loss limit', () => {
    const result = checkOrderRisk({
      ...base,
      quantity: 100,
      price: 100,
      portfolio: portfolio({
        equity: 970_000,
        cash: 970_000,
        dayStartEquity: 1_000_000,
      }),
    })
    expect(result.violations.some(v => v.includes('Дневной убыток'))).toBe(true)
  })
})

describe('invalidated ideas', () => {
  it('blocks buying at or below the stop', () => {
    const result = checkOrderRisk({
      side: 'buy',
      instrumentId: 'a',
      sector: 'energy',
      lotSize: 1,
      stopLoss: 97.5,
      avgTurnover: 1e9,
      limits: DEFAULT_RISK_LIMITS,
      costs: DEFAULT_COSTS,
      quantity: 10,
      price: 87.59,
      portfolio: portfolio(),
    })
    expect(result.ok).toBe(false)
    expect(result.violations.join(' ')).toMatch(/опровержения/)
  })
})

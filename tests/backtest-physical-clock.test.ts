import { describe, expect, it } from 'vitest'
import { backtest } from '../server/domain/evaluations/backtest'
import { DEFAULT_RULES } from '../server/domain/strategies/rules'
import type { Candle } from '../shared/types/investment'

// Synthetic price/time fixtures verify mechanics only; no observed market or profitability claim.
const day = 86_400_000
const series: Candle[] = Array.from({ length: 340 }, (_, i) => {
  const ts = new Date(Date.UTC(2024, 0, 1) + i * day).toISOString()
  const date = ts.slice(0, 10)
  return {
    ts,
    open: 100 + i,
    high: 102 + i,
    low: 99 + i,
    close: 101 + i,
    volume: 1e8,
    dataSource: 'moex_iss',
    barPolicyId: 'physical_session_v1',
    normalizationVersion: 'fixture-policy',
    physicalSessionDate: date,
    sessionDate: date,
    earliestUseAt: new Date(Date.parse(ts) + 2 * day - 3 * 3_600_000).toISOString(),
  }
})
const rules = {
  ...DEFAULT_RULES.position,
  rsiMax: 100,
  minAvgTurnover: 0,
}
const costs = {
  commissionPct: 0,
  spreadPct: 0,
  slippagePct: 0,
}
const run = (bars: Candle[], benchmark: Candle[] = []) => backtest('position', rules, [{
  symbol: 'SYNTHETIC',
  candles: bars,
}], benchmark, costs)

describe('physical reconstruction backtest clock', () => {
  it('signals only when required OHLC becomes eligible and never enters an earlier physical session', () => {
    const result = run(series)
    expect(result.trades.length).toBeGreaterThan(0)
    for (const trade of result.trades) {
      const entered = series.find(bar => bar.ts === trade.entryAt)!
      const physicalStart = Date.parse(`${entered.physicalSessionDate}T00:00:00+03:00`)
      expect(physicalStart).toBeGreaterThanOrEqual(Date.parse(trade.signalAt))
      const signalBar = series.find(bar => bar.ts === trade.signalBarAt)!
      expect(trade.signalAt).toBe(signalBar.earliestUseAt)
      expect(physicalStart).toBeGreaterThanOrEqual(Date.parse(signalBar.earliestUseAt!))
      expect(trade.entrySessionStartsAt).toBe(new Date(physicalStart).toISOString())
    }
  })
  it('does not use an index observation before its own eligibility time', () => {
    const regimeRules = {
      ...rules,
      regimeSma: 50,
    }
    const replay = (benchmark: Candle[]) => backtest('position', regimeRules, [{
      symbol: 'SYNTHETIC',
      candles: series,
    }], benchmark, costs)
    expect(replay(series).trades.length).toBeGreaterThan(0)
    const delayedIndex = series.map(bar => ({
      ...bar,
      earliestUseAt: new Date(Date.parse(bar.earliestUseAt!) + 500 * day).toISOString(),
    }))
    expect(replay(delayedIndex).trades).toHaveLength(0)
  })
  it('refuses physical replay with an unproven eligibility timestamp', () => {
    const result = run(series.map(bar => ({
      ...bar,
      earliestUseAt: undefined,
    })))
    expect(result.trades).toHaveLength(0)
    expect(result.audit.timingIssues).toContain('SYNTHETIC:physical_replay_missing_or_mixed_eligibility_clock')
  })
  it('cannot close in-sample with OHLC not eligible until the holdout period', () => {
    const splitAt = series[290]!.ts
    const result = backtest('position', rules, [{
      symbol: 'SYNTHETIC',
      candles: series,
    }], [], costs, undefined, splitAt)
    expect(result.trades.length).toBeGreaterThan(0)
    for (const trade of result.trades) {
      expect(series.find(bar => bar.ts === trade.exitAt)!.earliestUseAt! < splitAt).toBe(true)
      expect(trade.signalAt < splitAt).toBe(true)
    }
  })
})

import { describe, expect, it } from 'vitest'
import { aggregateStats, simulateOutcome, periodReturn } from '../server/domain/evaluations/outcome'
import type { Candle } from '../shared/types/investment'

const NO_COSTS = {
  commissionPct: 0,
  spreadPct: 0,
  slippagePct: 0,
}

function bars(rows: [number, number, number, number][]): Candle[] {
  return rows.map(([open, high, low, close], i) => ({
    ts: new Date(Date.UTC(2024, 0, 2 + i)).toISOString(),
    open,
    high,
    low,
    close,
    volume: 1,
  }))
}

const entry = {
  type: 'market_next_open' as const,
  price: 100,
  validDays: 1,
  note: '',
}
const exit = {
  stopLoss: 95,
  takeProfit: 110,
  timeExitDays: 3,
  note: '',
}

describe('simulateOutcome', () => {
  it.each(['market_next_open', 'limit'] as const)('does not profit from an entry gap below the stop (%s)', (type) => {
    const result = simulateOutcome({
      future: bars([[90, 97, 88, 94]]),
      benchmarkFuture: [],
      entry: {
        ...entry,
        type,
      },
      exit,
      costs: NO_COSTS,
    })
    expect(result.entryPrice).toBe(90)
    expect(result.exitPrice).toBe(90)
    expect(result.grossReturn).toBe(0)
    expect(result.exitReason).toBe('stop_loss')
  })
  it('executes an existing target gap before a later intraday stop', () => {
    const result = simulateOutcome({
      future: bars([[100, 104, 99, 101], [115, 120, 90, 100]]),
      benchmarkFuture: [],
      entry,
      exit,
      costs: NO_COSTS,
    })
    expect(result.exitReason).toBe('take_profit')
    expect(result.exitPrice).toBe(115)
  })
  it('does not use a pre-entry high as a limit-entry take profit', () => {
    const result = simulateOutcome({
      future: bars([[115, 120, 99, 101]]),
      benchmarkFuture: [],
      entry: {
        ...entry,
        type: 'limit',
      },
      exit,
      costs: NO_COSTS,
    })
    expect(result.complete).toBe(false)
    expect(result.entryPrice).toBe(100)
  })
  it('hits take profit', () => {
    const r = simulateOutcome({
      future: bars([[100, 105, 99, 104], [104, 111, 103, 110]]),
      benchmarkFuture: [],
      entry,
      exit,
      costs: NO_COSTS,
    })
    expect(r.exitReason).toBe('take_profit')
    expect(r.netReturn).toBeCloseTo(0.1)
    expect(r.outcome).toBe('win')
  })
  it('resolves same-bar ambiguity to the stop', () => {
    const r = simulateOutcome({
      future: bars([[100, 112, 94, 100]]),
      benchmarkFuture: [],
      entry,
      exit,
      costs: NO_COSTS,
    })
    expect(r.exitReason).toBe('stop_loss')
  })
  it('fills gap-downs at the open, not the stop', () => {
    const r = simulateOutcome({
      future: bars([[100, 101, 99, 100], [90, 91, 89, 90]]),
      benchmarkFuture: [],
      entry,
      exit,
      costs: NO_COSTS,
    })
    expect(r.exitPrice).toBe(90)
  })
  it('exits on time and subtracts costs', () => {
    const r = simulateOutcome({
      future: bars([[100, 101, 99, 100], [100, 101, 99, 101], [101, 102, 100, 102]]),
      benchmarkFuture: bars([[1000, 1000, 1000, 1000], [1000, 1000, 1000, 1000], [1010, 1010, 1010, 1010]]),
      entry,
      exit,
      costs: {
        commissionPct: 0.05,
        spreadPct: 0.05,
        slippagePct: 0.1,
      },
    })
    expect(r.exitReason).toBe('time_exit')
    expect(r.netReturn).toBeCloseTo(0.02 - 0.0035)
    expect(r.benchmarkReturn).toBeCloseTo(0.01)
  })
  it('is pending until enough data exists and reports non-entry for limits', () => {
    expect(simulateOutcome({
      future: bars([[100, 101, 99, 100]]),
      benchmarkFuture: [],
      entry,
      exit,
      costs: NO_COSTS,
    }).complete).toBe(false)
    const r = simulateOutcome({
      future: bars([[100, 101, 99, 100], [100, 101, 99, 100]]),
      benchmarkFuture: [],
      entry: {
        ...entry,
        type: 'limit',
        price: 90,
        validDays: 2,
      },
      exit,
      costs: NO_COSTS,
    })
    expect(r.exitReason).toBe('not_entered')
    expect(r.complete).toBe(true)
  })
})

describe('aggregateStats', () => {
  it('excludes non-entries from win rate', () => {
    const s = aggregateStats([
      {
        netReturn: 0.1,
        excessReturn: 0.05,
        maxDrawdown: -0.02,
        outcome: 'win',
      },
      {
        netReturn: -0.05,
        excessReturn: -0.06,
        maxDrawdown: -0.05,
        outcome: 'loss',
      },
      {
        netReturn: 0,
        excessReturn: 0,
        maxDrawdown: 0,
        outcome: 'no_entry',
      },
    ])
    expect(s.traded).toBe(2)
    expect(s.winRate).toBe(0.5)
    expect(s.profitFactor).toBeCloseTo(2)
  })
})

describe('backtest point-in-time', async () => {
  const { backtest } = await import('../server/domain/evaluations/backtest')
  const { DEFAULT_RULES } = await import('../server/domain/strategies/rules')
  const { MockMarketDataProvider } = await import('../server/adapters/market/mock')
  it('uses an exclusive end and cannot observe prices after the split', async () => {
    const market = new MockMarketDataProvider(() => new Date('2026-10-23T12:00:00Z'))
    const candles = await market.getCandles('SBER@MISX', new Date('2023-01-01'), new Date('2026-10-23'))
    const splitAt = '2026-03-01T00:00:00.000Z'
    const rules = {
      ...DEFAULT_RULES.position,
      rsiMax: 100,
      minAvgTurnover: 0,
    }
    const run = (data: Candle[]) => backtest('position', rules, [{
      symbol: 'SBER@MISX',
      candles: data,
    }], [], NO_COSTS, undefined, splitAt)
    const baseline = run(candles)
    expect(baseline.trades.length).toBeGreaterThan(0)
    expect(baseline.trades.every(t => t.signalAt < splitAt && t.entryAt < splitAt && t.exitAt < splitAt)).toBe(true)
    const changed = candles.map(c => c.ts < splitAt
      ? c
      : {
          ...c,
          open: 1,
          high: 1e9,
          low: 0.1,
          close: 1e9,
        })
    expect(run(changed)).toEqual(baseline)
    expect(run(candles.filter(c => c.ts < splitAt))).toEqual(baseline)
    const holdout = backtest('position', rules, [{
      symbol: 'SBER@MISX',
      candles,
    }], [], NO_COSTS, splitAt)
    expect(holdout.trades.every(t => t.signalAt >= splitAt && t.entryAt >= splitAt)).toBe(true)
  })
  it('never records a trade that closes after the series end', async () => {
    const market = new MockMarketDataProvider(() => new Date('2026-10-23T12:00:00Z'))
    const cutoff = '2026-03-01T00:00:00.000Z'
    const candles = (await market.getCandles('SBER@MISX', new Date('2023-01-01'), new Date('2026-10-23'))).filter(c => c.ts <= cutoff)
    const result = backtest('swing', DEFAULT_RULES.swing, [{
      symbol: 'SBER@MISX',
      candles,
    }], [], NO_COSTS)
    expect(result.trades.length).toBeGreaterThan(0)
    expect(result.trades.every(t => t.signalAt < cutoff && t.setupType !== 'none')).toBe(true)
  })
})

describe('nullable benchmark comparison', () => {
  const future = bars([[100, 103, 99, 102], [102, 105, 101, 104], [104, 106, 103, 105]])
  const bench = bars([[1000, 1000, 1000, 1000], [1000, 1000, 1000, 1000], [1000, 1000, 1000, 1000]])
  it('preserves absolute outcomes while missing benchmark is null rather than zero', () => {
    const result = simulateOutcome({
      future,
      benchmarkFuture: [],
      entry,
      exit,
      costs: NO_COSTS,
    })
    expect(result.netReturn).toBeCloseTo(0.05)
    expect(result.benchmarkReturn).toBeNull()
    expect(result.excessReturn).toBeNull()
    expect(result.benchmarkStatus).toBe('benchmark_unavailable')
  })
  it('keeps genuine flat benchmark as the number zero', () => {
    const result = simulateOutcome({
      future,
      benchmarkFuture: bench,
      entry,
      exit,
      costs: NO_COSTS,
    })
    expect(result.benchmarkReturn).toBe(0)
    expect(result.excessReturn).toBeCloseTo(0.05)
    expect(result.benchmarkStatus).toBe('available')
  })
  it('requires exact start/end and every interior date instead of nearest-date substitution', () => {
    const [start, , end] = future
    expect(periodReturn(bench, start!.ts, end!.ts, future)).toBe(0)
    expect(periodReturn(bench.slice(1), start!.ts, end!.ts, future)).toBeNull()
    expect(periodReturn(bench.slice(0, -1), start!.ts, end!.ts, future)).toBeNull()
    expect(periodReturn([bench[0]!, bench[2]!], start!.ts, end!.ts, future)).toBeNull()
    expect(periodReturn([bench[0]!, bench[1]!, bench[1]!, bench[2]!], start!.ts, end!.ts, future)).toBeNull()
    expect(periodReturn([...bench].reverse(), start!.ts, end!.ts, future)).toBeNull()
  })
  it('rejects physical/logical or different-source axes even when dates happen to match', () => {
    const physical = future.map(bar => ({
      ...bar,
      barPolicyId: 'physical_session_v1',
      dataSource: 'moex_iss',
      sessionDate: bar.ts.slice(0, 10),
    }))
    const logical = bench.map(bar => ({
      ...bar,
      barPolicyId: 'logical_trading_day_v1',
      dataSource: 'moex_iss',
    }))
    expect(periodReturn(logical, future[0]!.ts, future[2]!.ts, physical)).toBeNull()
    expect(periodReturn(bench, future[0]!.ts, future[2]!.ts, physical)).toBeNull()
    const otherSource = bench.map(bar => ({
      ...bar,
      barPolicyId: 'physical_session_v1',
      dataSource: 'finam',
    }))
    expect(periodReturn(otherSource, future[0]!.ts, future[2]!.ts, physical)).toBeNull()
  })
  it('counts comparable trades separately without averaging nulls as zeros', () => {
    const stats = aggregateStats([
      {
        netReturn: 0.1,
        excessReturn: null,
        maxDrawdown: -0.1,
        outcome: 'win',
      },
      {
        netReturn: 0.2,
        excessReturn: 0.1,
        maxDrawdown: -0.05,
        outcome: 'win',
      },
      {
        netReturn: 0.1,
        excessReturn: 0,
        maxDrawdown: -0.01,
        outcome: 'win',
      },
    ])
    expect(stats.n_abs).toBe(3)
    expect(stats.n_relative).toBe(2)
    expect(stats.avgNetReturn).toBeCloseTo(0.4 / 3)
    expect(stats.avgExcessReturn).toBeCloseTo(0.05)
    expect(stats.benchmarkStatus).toBe('partial')
    expect(aggregateStats([{
      netReturn: 0.1,
      excessReturn: null,
      maxDrawdown: -0.1,
      outcome: 'win',
    }]).avgExcessReturn).toBeNull()
    expect(aggregateStats([]).avgExcessReturn).toBeNull()
  })
})

describe('walk-forward nullable comparison', () => {
  it('keeps absolute trades and null relative means in both splits when the optional index is unavailable', async () => {
    const { walkForwardCompare } = await import('../server/domain/evaluations/backtest')
    const { DEFAULT_RULES } = await import('../server/domain/strategies/rules')
    const { MockMarketDataProvider } = await import('../server/adapters/market/mock')
    const market = new MockMarketDataProvider(() => new Date('2026-10-23T12:00:00Z'))
    const candles = await market.getCandles('SBER@MISX', new Date('2023-01-01'), new Date('2026-10-23'))
    const rules = {
      ...DEFAULT_RULES.position,
      rsiMax: 100,
      minAvgTurnover: 0,
    }
    const result = walkForwardCompare('position', [{
      label: 'unchanged test rule set',
      rules,
    }], [{
      symbol: 'SBER@MISX',
      candles,
    }], [], NO_COSTS)
    expect(result.splitAt).not.toBeNull()
    expect(result.results).toHaveLength(1)
    const stats = result.results[0]!
    expect(stats.inSample.n_abs + stats.outOfSample.n_abs).toBeGreaterThan(0)
    for (const sample of [stats.inSample, stats.outOfSample]) {
      expect(sample.n_relative).toBe(0)
      expect(sample.avgExcessReturn).toBeNull()
      expect(sample.benchmarkStatus).toBe('benchmark_unavailable')
    }
  })
})

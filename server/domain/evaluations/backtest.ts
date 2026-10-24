import type { Candle, CostModel, StrategyId, StrategyRules } from '../../../shared/types/investment'
import { evaluateSignal } from '../strategies/rules'
import { aggregateStats, simulateOutcome, type StatsRow } from './outcome'

export interface BacktestSeries {
  symbol: string
  candles: Candle[]
}

export interface BacktestTrade extends StatsRow {
  symbol: string
  signalAt: string
  entryAt: string
  exitAt: string
  setupType: string
  exitReason: string
}

const WARMUP = 210

/** Point-in-time replay: each signal sees only candles up to its own bar. */
export function backtest(strategy: StrategyId, rules: StrategyRules, series: BacktestSeries[], benchmark: Candle[], costs: CostModel, from?: string, to?: string) {
  const trades: BacktestTrade[] = []
  const benchmarkIndex = new Map(benchmark.map((c, i) => [c.ts, i]))
  const benchmarkUpTo = (ts: string) => {
    if (!rules.regimeSma) {
      return []
    }
    let idx = benchmarkIndex.get(ts)
    if (idx === undefined) {
      idx = benchmark.findLastIndex(c => c.ts <= ts)
    }
    return idx < 0 ? [] : benchmark.slice(Math.max(0, idx - 260), idx + 1)
  }
  for (const { symbol, candles } of series) {
    let i = WARMUP
    while (i < candles.length - 1) {
      const bar = candles[i]!
      if ((from && bar.ts < from) || (to && bar.ts >= to)) {
        i++
        continue
      }
      const history = candles.slice(Math.max(0, i - 260), i + 1)
      const signal = evaluateSignal(strategy, rules, history, benchmarkUpTo(bar.ts))
      if (!signal.setup || signal.stopLoss === null || signal.takeProfit === null) {
        i++
        continue
      }
      // `to` is exclusive for both signals and executions, so in-sample
      // cannot see outcomes from the holdout period.
      const future = candles.slice(i + 1).filter(c => !to || c.ts < to)
      const result = simulateOutcome({
        future,
        benchmarkFuture: benchmark.filter(c => c.ts > bar.ts && (!to || c.ts < to)),
        entry: {
          type: 'market_next_open',
          price: signal.entry!,
          validDays: 1,
          note: '',
        },
        exit: {
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          timeExitDays: rules.horizonDays,
          note: '',
        },
        costs,
      })
      if (!result.complete || !result.exitAt) {
        break
      }
      trades.push({
        symbol,
        signalAt: bar.ts,
        entryAt: result.entryAt!,
        exitAt: result.exitAt,
        setupType: signal.setupType,
        exitReason: result.exitReason,
        netReturn: result.netReturn,
        excessReturn: result.excessReturn,
        maxDrawdown: result.maxDrawdown,
        outcome: result.outcome,
      })
      const exitIndex = candles.findIndex(c => c.ts === result.exitAt)
      i = Math.max(exitIndex + 1, i + 1)
    }
  }
  return {
    trades,
    stats: aggregateStats(trades),
  }
}

/** Walk-forward split: rules compared on the same in-sample and later out-of-sample windows. */
export function walkForwardCompare(strategy: StrategyId, versions: {
  label: string
  rules: StrategyRules
}[], series: BacktestSeries[], benchmark: Candle[], costs: CostModel, splitRatio = 0.6) {
  const dates = [...new Set(series.flatMap(s => s.candles.slice(WARMUP).map(c => c.ts)))].sort()
  if (dates.length < 20) {
    return {
      splitAt: null,
      results: [],
    }
  }
  const splitAt = dates[Math.floor(dates.length * splitRatio)]!
  return {
    splitAt,
    results: versions.map(v => ({
      label: v.label,
      inSample: backtest(strategy, v.rules, series, benchmark, costs, undefined, splitAt).stats,
      outOfSample: backtest(strategy, v.rules, series, benchmark, costs, splitAt).stats,
    })),
  }
}

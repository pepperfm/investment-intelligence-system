import { createHash } from 'node:crypto'
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
  signalBarAt: string
  signalEligibleAt: string
  entrySessionStartsAt: string | null
  entryAt: string
  exitAt: string
  setupType: string
  exitReason: string
  entryPrice: number
  exitPrice: number
  grossReturn: number
  benchmarkReturn: number | null
  benchmarkStatus: 'available' | 'benchmark_unavailable'
}

const WARMUP = 210

const physical = (bar: Candle) => bar.barPolicyId === 'physical_session_v1'
const eligibleAt = (bar: Candle) => Date.parse(physical(bar) ? bar.earliestUseAt ?? '' : bar.ts)
const sessionStart = (bar: Candle) => physical(bar)
  ? Date.parse(`${bar.physicalSessionDate ?? bar.sessionDate ?? ''}T00:00:00+03:00`)
  : Date.parse(bar.ts)

/** Point-in-time replay: each signal sees only candles up to its own bar. */
export function backtest(strategy: StrategyId, rules: StrategyRules, series: BacktestSeries[], benchmark: Candle[], costs: CostModel, from?: string, to?: string) {
  series = series.map(s => ({
    ...s,
    candles: s.candles.filter(c => !to || (c.ts < to && (!physical(c) || eligibleAt(c) < Date.parse(to)))),
  }))
  benchmark = benchmark.filter(c => !to || (c.ts < to && (!physical(c) || eligibleAt(c) < Date.parse(to))))
  const trades: BacktestTrade[] = []
  const benchmarkIndex = new Map(benchmark.map((c, i) => [c.ts, i]))
  const benchmarkUpTo = (ts: string, signalEligibleAt: number) => {
    if (!rules.regimeSma) {
      return []
    }
    const idx = benchmarkIndex.get(ts)
    if (idx === undefined) {
      return []
    }
    return benchmark.slice(Math.max(0, idx - 260), idx + 1).filter(row => !physical(row) || eligibleAt(row) <= signalEligibleAt)
  }
  const timingIssues: string[] = []
  for (const { symbol, candles } of series) {
    if (candles.some(bar => physical(bar) !== physical(candles[0]!)) || candles.some(bar => physical(bar) && (!Number.isFinite(eligibleAt(bar)) || !Number.isFinite(sessionStart(bar))))) {
      timingIssues.push(`${symbol}:physical_replay_missing_or_mixed_eligibility_clock`)
      continue
    }
    let i = WARMUP
    while (i < candles.length - 1) {
      const bar = candles[i]!
      const history = candles.slice(Math.max(0, i - 260), i + 1)
      // A physical date labels a session, not the instant at which its complete OHLC was usable.
      const signalClock = physical(bar) ? Math.max(...history.map(eligibleAt)) : Date.parse(bar.ts)
      const signalAt = new Date(signalClock).toISOString()
      if ((from && signalAt < from) || (to && signalAt >= to)) {
        i++
        continue
      }
      const signal = evaluateSignal(strategy, rules, history, benchmarkUpTo(bar.ts, signalClock))
      if (!signal.setup || signal.stopLoss === null || signal.takeProfit === null) {
        i++
        continue
      }
      // `to` is exclusive for both signals and executions, so in-sample
      // cannot see outcomes from the holdout period.
      const future = candles.slice(i + 1).filter(c => (!physical(bar) || sessionStart(c) >= signalClock) && (!to || c.ts < to))
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
        signalAt,
        signalBarAt: bar.ts,
        signalEligibleAt: signalAt,
        entrySessionStartsAt: physical(bar) ? new Date(sessionStart(future.find(c => c.ts === result.entryAt)!)).toISOString() : null,
        entryAt: result.entryAt!,
        exitAt: result.exitAt,
        setupType: signal.setupType,
        exitReason: result.exitReason,
        entryPrice: result.entryPrice!,
        exitPrice: result.exitPrice!,
        grossReturn: result.grossReturn,
        netReturn: result.netReturn,
        excessReturn: result.excessReturn,
        benchmarkReturn: result.benchmarkReturn,
        benchmarkStatus: result.benchmarkStatus,
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
    audit: {
      timingPolicy: 'physical_signal_at_earliest_use_then_whole_future_session_v1',
      timingIssues,
      strategy,
      rules,
      rulesHash: evaluationHash(rules),
      costModel: costs,
      costModelHash: evaluationHash(costs),
      inputSeriesHash: evaluationHash({
        series,
        benchmark,
      }),
      universe: series.map(s => ({
        symbol: s.symbol,
        bars: s.candles.length,
        from: s.candles[0]?.ts ?? null,
        to: s.candles.at(-1)?.ts ?? null,
      })),
      universeCoverage: 'Current active universe only; historical membership/delistings unavailable. Survivorship bias possible.',
      overlappingSamples: 'all / sameSetup / sameSymbol overlap and are not independent evidence.',
      series,
      benchmark,
      trades,
      from: from ?? null,
      toExclusive: to ?? null,
    },
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

/** Stable object-key ordering for immutable input/version identities. */
export function evaluationHash(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      return v.map(canonical)
    }
    if (!v || typeof v !== 'object') {
      return v
    }
    return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, item]) => [k, canonical(item)]))
  }
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

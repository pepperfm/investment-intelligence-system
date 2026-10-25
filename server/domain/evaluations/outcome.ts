import type { Candle, CostModel, EntryScenario, EvaluationCosts, ExitScenario } from '../../../shared/types/investment'
import { benchmarkWindowIssues } from '../market/dependencies'

export interface OutcomeInput {
  /** Candles strictly after the evidence timestamp, chronological. */
  future: Candle[]
  benchmarkFuture: Candle[]
  entry: EntryScenario
  exit: ExitScenario
  costs: CostModel
}

export interface OutcomeResult {
  complete: boolean
  entered: boolean
  entryAt: string | null
  exitAt: string | null
  entryPrice: number | null
  exitPrice: number | null
  exitReason: 'stop_loss' | 'take_profit' | 'time_exit' | 'not_entered' | 'pending'
  grossReturn: number
  netReturn: number
  benchmarkReturn: number | null
  excessReturn: number | null
  benchmarkStatus: 'available' | 'benchmark_unavailable'
  maxDrawdown: number
  maxFavorable: number
  outcome: 'win' | 'loss' | 'flat' | 'no_entry'
  costs: EvaluationCosts
}

const FLAT_BAND = 0.002

/**
 * Deterministic long-only trade simulation.
 * Same-bar stop/target ambiguity resolves to the stop (conservative). Gaps fill at the open.
 */
export function simulateOutcome({ future, benchmarkFuture, entry, exit, costs }: OutcomeInput): OutcomeResult {
  const totalCostPct = (2 * costs.commissionPct + costs.spreadPct + 2 * costs.slippagePct) / 100
  const costsInfo: EvaluationCosts = {
    commission: 2 * costs.commissionPct / 100,
    spread: costs.spreadPct / 100,
    slippage: 2 * costs.slippagePct / 100,
    totalPct: totalCostPct,
  }
  const empty: OutcomeResult = {
    complete: false,
    entered: false,
    entryAt: null,
    exitAt: null,
    entryPrice: null,
    exitPrice: null,
    exitReason: 'pending',
    grossReturn: 0,
    netReturn: 0,
    benchmarkReturn: null,
    excessReturn: null,
    benchmarkStatus: 'benchmark_unavailable',
    maxDrawdown: 0,
    maxFavorable: 0,
    outcome: 'no_entry',
    costs: costsInfo,
  }
  let entryIndex = -1
  let entryPrice = 0
  const window = Math.min(entry.validDays, future.length)
  for (let i = 0; i < window; i++) {
    const bar = future[i]!
    if (entry.type === 'market_next_open') {
      entryIndex = i
      entryPrice = bar.open
      break
    }
    if (bar.low <= entry.price) {
      entryIndex = i
      entryPrice = Math.min(bar.open, entry.price)
      break
    }
  }
  if (entryIndex < 0) {
    if (future.length >= entry.validDays) {
      return {
        ...empty,
        complete: true,
        exitReason: 'not_entered',
      }
    }
    return empty
  }
  let worst = 0
  let best = 0
  let exitPrice: number | null = null
  let exitIndex = -1
  let exitReason: OutcomeResult['exitReason'] = 'pending'
  const lastIndex = entryIndex + exit.timeExitDays - 1
  for (let i = entryIndex; i < future.length && i <= lastIndex; i++) {
    const bar = future[i]!
    // An opening gap crosses the level before any intraday high/low. This also
    // applies to the entry bar: buying below the stop cannot create a profit.
    const enteredAtOpen = i > entryIndex || entryPrice === bar.open
    if (enteredAtOpen && (bar.open <= exit.stopLoss || bar.open >= exit.takeProfit)) {
      exitPrice = bar.open
      exitReason = bar.open <= exit.stopLoss ? 'stop_loss' : 'take_profit'
      exitIndex = i
      worst = Math.min(worst, bar.open / entryPrice - 1)
      best = Math.max(best, bar.open / entryPrice - 1)
      break
    }
    worst = Math.min(worst, bar.low / entryPrice - 1)
    best = Math.max(best, bar.high / entryPrice - 1)
    if (bar.low <= exit.stopLoss) {
      exitPrice = exit.stopLoss
      exitReason = 'stop_loss'
      exitIndex = i
      break
    }
    if (bar.high >= exit.takeProfit && (i > entryIndex || entryPrice === bar.open)) {
      exitPrice = exit.takeProfit
      exitReason = 'take_profit'
      exitIndex = i
      break
    }
    if (i === lastIndex) {
      exitPrice = bar.close
      exitReason = 'time_exit'
      exitIndex = i
    }
  }
  if (exitPrice === null) {
    return {
      ...empty,
      entered: true,
      entryAt: future[entryIndex]!.ts,
      entryPrice,
      maxDrawdown: worst,
      maxFavorable: best,
    }
  }
  const grossReturn = exitPrice / entryPrice - 1
  const netReturn = grossReturn - totalCostPct
  const benchmarkReturn = periodReturn(benchmarkFuture, future[entryIndex]!.ts, future[exitIndex]!.ts, future.slice(entryIndex, exitIndex + 1))
  return {
    complete: true,
    entered: true,
    entryAt: future[entryIndex]!.ts,
    exitAt: future[exitIndex]!.ts,
    entryPrice,
    exitPrice,
    exitReason,
    grossReturn,
    netReturn,
    benchmarkReturn,
    excessReturn: benchmarkReturn === null ? null : netReturn - benchmarkReturn,
    benchmarkStatus: benchmarkReturn === null ? 'benchmark_unavailable' : 'available',
    maxDrawdown: worst,
    maxFavorable: best,
    outcome: netReturn > FLAT_BAND ? 'win' : netReturn < -FLAT_BAND ? 'loss' : 'flat',
    costs: costsInfo,
  }
}

/** Exact open-to-close comparison on the entire held axis. Missing observations are not 0% returns. */
export function periodReturn(candles: readonly Candle[], fromTs: string, toTs: string, referenceAxis: readonly Candle[]): number | null {
  if (!Number.isFinite(Date.parse(fromTs)) || !Number.isFinite(Date.parse(toTs)) || fromTs > toTs) {
    return null
  }
  const axis = referenceAxis.filter(bar => bar.ts >= fromTs && bar.ts <= toTs)
  const rows = candles.filter(bar => bar.ts >= fromTs && bar.ts <= toTs)
  if (!axis.length || rows.length !== axis.length || axis[0]!.ts !== fromTs || axis.at(-1)!.ts !== toTs) {
    return null
  }
  if (benchmarkWindowIssues(axis, rows, axis.length).length) {
    return null
  }
  if (rows.some(benchmark => ![benchmark.open, benchmark.high, benchmark.low, benchmark.close].every(value => Number.isFinite(value) && value > 0)
    || benchmark.low > Math.min(benchmark.open, benchmark.close) || benchmark.high < Math.max(benchmark.open, benchmark.close))) {
    return null
  }
  return rows.at(-1)!.close / rows[0]!.open - 1
}

export interface StatsRow {
  netReturn: number
  excessReturn: number | null
  maxDrawdown: number
  outcome: string
}

export function aggregateStats(rows: StatsRow[]) {
  const traded = rows.filter(r => r.outcome !== 'no_entry')
  const relative = traded.filter((row): row is StatsRow & { excessReturn: number } => row.excessReturn !== null && Number.isFinite(row.excessReturn))
  const wins = traded.filter(r => r.outcome === 'win').length
  const avg = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
  const grossWins = traded.filter(r => r.netReturn > 0).reduce((s, r) => s + r.netReturn, 0)
  const grossLosses = -traded.filter(r => r.netReturn < 0).reduce((s, r) => s + r.netReturn, 0)
  const relativeStatus = !relative.length ? 'benchmark_unavailable' as const : relative.length === traded.length ? 'available' as const : 'partial' as const
  const absoluteTradeStats = {
    n: traded.length,
    avgNetReturn: traded.length ? avg(traded.map(r => r.netReturn)) : null,
  }
  const benchmarkRelativeStats = {
    n: relative.length,
    status: relativeStatus,
    avgExcessReturn: relative.length ? avg(relative.map(r => r.excessReturn)) : null,
  }
  return {
    absoluteTradeStats,
    benchmarkRelativeStats,
    count: rows.length,
    traded: traded.length,
    n_abs: traded.length,
    n_relative: relative.length,
    benchmarkStatus: relativeStatus,
    winRate: traded.length ? wins / traded.length : 0,
    avgNetReturn: avg(traded.map(r => r.netReturn)),
    avgExcessReturn: relative.length ? avg(relative.map(r => r.excessReturn)) : null,
    worstDrawdown: traded.length ? Math.min(...traded.map(r => r.maxDrawdown)) : 0,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0,
  }
}

export const EVALUATION_VERSION = 'scenario-decision-v3-nullable-benchmark'
export type EvaluationStatus = 'not_entered' | 'missing_future_data' | 'ambiguous_session' | 'incomplete_horizon' | 'evaluated'

export interface ScenarioDecisionInput extends OutcomeInput {
  recommendation: 'long' | 'no_trade'
  evidenceQuality: {
    validationOk: boolean
    decisionVerdict: string | null
    semantics: 'explicit' | 'legacy'
  }
  /** Unknown/legacy feed or mismatched calendar cannot produce numeric conclusions. */
  qualityIssues?: string[]
}

/** A simulated purchase never establishes the truth of a decision or a price forecast. */
export function evaluateScenarioDecision(input: ScenarioDecisionInput) {
  const issues = input.qualityIssues ?? []
  const outcome = issues.length ? null : simulateOutcome(input)
  let status: EvaluationStatus
  if (issues.length) {
    status = 'ambiguous_session'
  } else if (!input.future.length) {
    status = 'missing_future_data'
  } else if (!outcome?.complete) {
    status = 'incomplete_horizon'
  } else {
    status = outcome.entered ? 'evaluated' : 'not_entered'
  }
  const hasReturn = status === 'evaluated' && outcome !== null
  const benchmarkAvailable = hasReturn && outcome.benchmarkReturn !== null
  return {
    evaluationVersion: EVALUATION_VERSION,
    status,
    issues,
    scenarioEvaluation: {
      isCounterfactual: true as const,
      status,
      entered: outcome?.entered ?? false,
      entryAt: outcome?.entryAt ?? null,
      exitAt: outcome?.exitAt ?? null,
      entryPrice: outcome?.entryPrice ?? null,
      exitPrice: outcome?.exitPrice ?? null,
      exitReason: outcome?.exitReason ?? 'pending',
      grossReturn: hasReturn ? outcome.grossReturn : null,
      netReturn: hasReturn ? outcome.netReturn : null,
      benchmarkReturn: benchmarkAvailable ? outcome.benchmarkReturn : null,
      benchmarkStatus: benchmarkAvailable ? 'available' as const : 'benchmark_unavailable' as const,
      benchmarkUnavailableReason: benchmarkAvailable ? null : 'Benchmark observations are missing, incomplete or not comparable to the held session axis.',
      excessReturn: benchmarkAvailable ? outcome.excessReturn : null,
      maxDrawdown: hasReturn ? outcome.maxDrawdown : null,
      maxFavorable: hasReturn ? outcome.maxFavorable : null,
      outcome: hasReturn ? outcome.outcome : null,
      costs: outcome?.costs ?? null,
    },
    decisionEvaluation: {
      recommendation: input.recommendation,
      evidenceQuality: input.evidenceQuality,
      cashReturn: 0,
      benchmarkReturn: benchmarkAvailable ? outcome.benchmarkReturn : null,
      benchmarkNote: 'IMOEX is an index, not an investable return; fees, tracking and dividends may differ.',
      avoidedLoss: input.recommendation === 'no_trade' && hasReturn ? Math.max(0, -outcome.netReturn) : null,
      missedGain: input.recommendation === 'no_trade' && hasReturn ? Math.max(0, outcome.netReturn) : null,
      conclusion: 'Single counterfactual trade does not establish decision correctness or forecast accuracy.',
    },
  }
}

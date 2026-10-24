import type { Candle, CostModel, EntryScenario, EvaluationCosts, ExitScenario } from '../../../shared/types/investment'

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
  benchmarkReturn: number
  excessReturn: number
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
    benchmarkReturn: 0,
    excessReturn: 0,
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
    worst = Math.min(worst, bar.low / entryPrice - 1)
    best = Math.max(best, bar.high / entryPrice - 1)
    if (bar.low <= exit.stopLoss) {
      exitPrice = i > entryIndex && bar.open < exit.stopLoss ? bar.open : exit.stopLoss
      exitReason = 'stop_loss'
      exitIndex = i
      break
    }
    if (bar.high >= exit.takeProfit) {
      exitPrice = i > entryIndex && bar.open > exit.takeProfit ? bar.open : exit.takeProfit
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
  const benchmarkReturn = periodReturn(benchmarkFuture, future[entryIndex]!.ts, future[exitIndex]!.ts)
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
    excessReturn: netReturn - benchmarkReturn,
    maxDrawdown: worst,
    maxFavorable: best,
    outcome: netReturn > FLAT_BAND ? 'win' : netReturn < -FLAT_BAND ? 'loss' : 'flat',
    costs: costsInfo,
  }
}

/** Open of the entry day to close of the exit day. */
export function periodReturn(candles: Candle[], fromTs: string, toTs: string) {
  const from = candles.find(c => c.ts >= fromTs)
  const to = [...candles].reverse().find(c => c.ts <= toTs)
  if (!from || !to) {
    return 0
  }
  return to.close / from.open - 1
}

export interface StatsRow {
  netReturn: number
  excessReturn: number
  maxDrawdown: number
  outcome: string
}

export function aggregateStats(rows: StatsRow[]) {
  const traded = rows.filter(r => r.outcome !== 'no_entry')
  const wins = traded.filter(r => r.outcome === 'win').length
  const avg = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
  const grossWins = traded.filter(r => r.netReturn > 0).reduce((s, r) => s + r.netReturn, 0)
  const grossLosses = -traded.filter(r => r.netReturn < 0).reduce((s, r) => s + r.netReturn, 0)
  return {
    count: rows.length,
    traded: traded.length,
    winRate: traded.length ? wins / traded.length : 0,
    avgNetReturn: avg(traded.map(r => r.netReturn)),
    avgExcessReturn: avg(traded.map(r => r.excessReturn)),
    worstDrawdown: traded.length ? Math.min(...traded.map(r => r.maxDrawdown)) : 0,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0,
  }
}

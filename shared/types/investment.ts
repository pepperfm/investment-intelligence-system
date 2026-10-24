export const STRATEGY_IDS = ['swing', 'position'] as const
export type StrategyId = typeof STRATEGY_IDS[number]

export const HYPOTHESIS_STATUSES = ['draft', 'awaiting_critic', 'needs_review', 'ready_for_user', 'user_approved', 'user_rejected', 'watching', 'closed', 'evaluated'] as const
export type HypothesisStatus = typeof HYPOTHESIS_STATUSES[number]

export const CRITIC_VERDICTS = ['supported', 'disputed', 'insufficient_evidence'] as const
export type CriticVerdict = typeof CRITIC_VERDICTS[number]

export type RunKind = 'research' | 'why_not_buy'
export type RunStatus = 'queued' | 'running' | 'completed' | 'failed'
export type Direction = 'long' | 'no_trade'

export interface Candle {
  ts: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface SourceRef {
  id: string
  kind: 'candles' | 'event' | 'report' | 'memory' | 'metrics' | 'backtest'
  title: string
  url: string | null
  asOf: string
}

export interface EvidenceItem {
  claim: string
  sourceIds: string[]
}

export interface AgentFinding {
  severity: 'info' | 'warning' | 'critical'
  topic: string
  detail: string
  sourceIds: string[]
}

export interface EntryScenario {
  type: 'market_next_open' | 'limit'
  price: number
  validDays: number
  note: string
}

export interface ExitScenario {
  stopLoss: number
  takeProfit: number
  timeExitDays: number
  note: string
}

export interface StrategyRules {
  horizonDays: number
  trendSma: number
  slowSma: number
  rsiPeriod: number
  rsiMin: number
  rsiMax: number
  breakoutLookback: number
  momentumLookback: number
  minMomentum: number
  atrPeriod: number
  stopAtr: number
  targetAtr: number
  minAvgTurnover: number
  entryValidDays: number
  maxVolatility: number
  /** Swing only: whether RSI pullbacks count as a setup (breakouts always do). Missing in old versions = true. */
  allowPullback?: boolean
  /** Minimum reward/risk for a setup and for hypothesis validation. Missing in old versions = 1.2. */
  minRewardRisk?: number
  /** Market regime filter: benchmark (IMOEX) close must be above its SMA of this length. 0 or missing = off. */
  regimeSma?: number
}

export const DEFAULT_MIN_REWARD_RISK = 1.2

export type NumericRuleKey = Exclude<keyof StrategyRules, 'allowPullback'>

export interface RiskLimits {
  maxPositionPct: number
  maxRiskPerTradePct: number
  maxTotalExposurePct: number
  maxSectorPct: number
  maxDailyLossPct: number
  maxAdvParticipationPct: number
  minAvgTurnover: number
  allowLeverage: false
}

export interface CostModel {
  commissionPct: number
  spreadPct: number
  slippagePct: number
}

export interface RiskCheckResult {
  ok: boolean
  violations: string[]
  warnings: string[]
  notional: number
  riskAmount: number
  exposureAfterPct: number
  sectorAfterPct: number
}

export interface EvaluationCosts {
  commission: number
  spread: number
  slippage: number
  totalPct: number
}

export interface PositionSnapshot {
  instrumentId: string
  symbol: string
  quantity: number
  avgPrice: number
  lastPrice: number
  marketValue: number
  unrealizedPnl: number
}

export interface RunLogEntry {
  at: string
  level: 'info' | 'warn' | 'error'
  message: string
}

export type MetricValues = Record<string, number | null>

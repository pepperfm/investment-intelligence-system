export const STRATEGY_IDS = ['swing', 'position'] as const
export type StrategyId = typeof STRATEGY_IDS[number]

export const HYPOTHESIS_STATUSES = ['draft', 'awaiting_critic', 'needs_review', 'ready_for_user', 'user_approved', 'user_rejected', 'watching', 'closed', 'evaluated'] as const
export type HypothesisStatus = typeof HYPOTHESIS_STATUSES[number]

export const CRITIC_VERDICTS = ['supported', 'disputed', 'insufficient_evidence'] as const
export type CriticVerdict = typeof CRITIC_VERDICTS[number]

export type RunKind = 'research' | 'why_not_buy'
export type RunStatus = 'queued' | 'running' | 'completed' | 'completed_with_blocks' | 'blocked' | 'failed'
export type Direction = 'long' | 'no_trade'

export interface Candle {
  physicalSessionDate?: string
  barPolicyId?: string
  earliestUseAt?: string
  observedAt?: string
  historicalAvailability?: 'verified' | 'unknown'
  reconstruction?: boolean
  sourceRevision?: string
  provenanceHash?: string
  sessionDate?: string
  tradingDate?: string
  sessionType?: 'regular' | 'weekend_additional' | 'holiday' | 'unknown'
  completedAt?: string
  availableAt?: string
  dataSource?: string
  board?: string
  adjustmentPolicy?: string
  normalizationVersion?: string
  contractVerified?: boolean
  ts: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface SourceRef {
  id: string
  kind: 'candles' | 'event' | 'report' | 'memory' | 'metrics' | 'backtest' | 'macro' | 'regulatory'
  title: string
  url: string | null
  asOf: string
  sourceId?: string
  publishedAt?: string | null
  availableAt?: string | null
  observedAt?: string
  contentHash?: string
  verification?: 'official_observed' | 'machine_verified' | 'manual_verified' | 'aggregated_unverified'
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
  /** Persisted paper quote provenance; source/policy stay fixed while new manual observations may arrive. */
  paperData?: {
    selection?: import('./market-data').ResearchBarSelection
    provenance: import('./market-data').ResearchProvenance | null
    status: string
    issues: string[]
    assessedAt: string
  }
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

export const DECISION_BASES = ['negative_historical_edge', 'missing_material_evidence', 'risk_limit', 'contradictory_signals', 'positive_evidence', 'other'] as const
export type DecisionBasis = typeof DECISION_BASES[number]
export type ForecastVerdict = CriticVerdict | 'not_applicable'
export interface PriceForecast {
  criterion: 'take_profit_before_stop' | 'stop_before_take_profit' | 'positive_net_return' | 'non_positive_net_return'
  windowTradingDays: number
  rationale: string
  sourceIds: string[]
}
/** Constructed by domain code, never proposed by an agent. */
export interface MarketScenario {
  entry: EntryScenario
  exit: ExitScenario
  horizonUnit?: 'logical_trading_days' | 'confirmed_sessions'
  deadlineConditional?: boolean
  inputSetVersion?: string
  researchSelection?: import('./market-data').ResearchBarSelection
  horizonTradingDays: number
  strategyVersionId: string
  version: number
  rulesHash: string
  calendarVersion: string
  normalizationVersion: string
  costs: CostModel
}
/** Legacy content is labelled rather than retroactively reinterpreted. */
export type HypothesisSemantics = 'legacy' | 'decision_v2'

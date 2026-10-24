import { z } from 'zod'
import { CRITIC_VERDICTS, STRATEGY_IDS } from '../types/investment'

const text = (max = 2000) => z.string().trim().min(1).max(max)
const sourceIds = z.array(z.string().max(80)).max(20)

export const evidenceItemSchema = z.object({
  claim: text(),
  sourceIds,
})

export const findingSchema = z.object({
  severity: z.enum(['info', 'warning', 'critical']),
  topic: text(200),
  detail: text(),
  sourceIds,
})

/** market_researcher output. Every field required: Codex structured output demands strict schemas. */
export const researchOutputSchema = z.object({
  observations: z.array(evidenceItemSchema).max(20),
  growthFactors: z.array(evidenceItemSchema).max(15),
  riskFactors: z.array(evidenceItemSchema).max(15),
  dataGaps: z.array(text(500)).max(15),
})
export type ResearchOutput = z.infer<typeof researchOutputSchema>

/** Root analyst draft hypothesis. Price levels are proposals; code re-validates them. */
export const analystOutputSchema = z.object({
  direction: z.enum(['long', 'no_trade']),
  thesis: text(3000),
  supportingEvidence: z.array(evidenceItemSchema).max(15),
  counterEvidence: z.array(evidenceItemSchema).max(15),
  assumptions: z.array(text(500)).max(15),
  invalidationConditions: z.array(text(500)).min(1).max(15),
  riskNotes: z.array(text(500)).max(15),
  alternatives: z.array(text(500)).max(10),
  confidence: z.number().min(0).max(1),
  entryNote: z.string().max(500),
  exitNote: z.string().max(500),
})
export type AnalystOutput = z.infer<typeof analystOutputSchema>

export const criticOutputSchema = z.object({
  verdict: z.enum(CRITIC_VERDICTS),
  summary: text(3000),
  findings: z.array(findingSchema).max(25),
  missingChecks: z.array(text(500)).max(15),
})
export type CriticOutput = z.infer<typeof criticOutputSchema>

export const outcomeReviewSchema = z.object({
  summary: text(3000),
  lessons: z.array(text(500)).max(10),
  forecastVsActual: text(1500),
  processIssues: z.array(text(500)).max(10),
  ruleSuggestions: z.array(z.object({
    parameter: z.string().max(60),
    direction: z.enum(['increase', 'decrease', 'keep']),
    rationale: text(500),
  })).max(5),
})
export type OutcomeReviewOutput = z.infer<typeof outcomeReviewSchema>

export const startRunInput = z.object({
  kind: z.enum(['research', 'why_not_buy']).default('research'),
  strategies: z.array(z.enum(STRATEGY_IDS)).min(1).max(2),
  instrumentIds: z.array(z.uuid()).min(1).max(30),
  asOf: z.iso.date().optional(),
})
export type StartRunInput = z.infer<typeof startRunInput>

export const hypothesisDecisionInput = z.object({
  action: z.enum(['approve', 'reject', 'defer', 'watch', 'close']),
  comment: z.string().trim().max(2000).optional(),
})

export const createOrderInput = z.object({
  hypothesisId: z.uuid().optional(),
  instrumentId: z.uuid(),
  side: z.enum(['buy', 'sell']),
  type: z.enum(['market', 'limit']),
  quantity: z.int().min(1).max(10_000_000),
  limitPrice: z.number().positive().optional(),
  idempotencyKey: z.string().min(8).max(100),
}).refine(value => value.type === 'market' || value.limitPrice !== undefined, { message: 'limitPrice is required for limit orders' })

export const riskLimitsInput = z.object({
  maxPositionPct: z.number().min(0.1).max(100),
  maxRiskPerTradePct: z.number().min(0.05).max(10),
  maxTotalExposurePct: z.number().min(1).max(100),
  maxSectorPct: z.number().min(1).max(100),
  maxDailyLossPct: z.number().min(0.1).max(50),
  maxAdvParticipationPct: z.number().min(0.01).max(100),
  minAvgTurnover: z.number().min(0),
})

export const costModelInput = z.object({
  commissionPct: z.number().min(0).max(5),
  spreadPct: z.number().min(0).max(5),
  slippagePct: z.number().min(0).max(5),
})

export const strategyRulesInput = z.object({
  horizonDays: z.int().min(1).max(365),
  trendSma: z.int().min(5).max(250),
  slowSma: z.int().min(10).max(400),
  rsiPeriod: z.int().min(2).max(50),
  rsiMin: z.number().min(0).max(100),
  rsiMax: z.number().min(0).max(100),
  breakoutLookback: z.int().min(5).max(250),
  momentumLookback: z.int().min(5).max(250),
  minMomentum: z.number().min(-1).max(5),
  atrPeriod: z.int().min(2).max(50),
  stopAtr: z.number().min(0.5).max(10),
  targetAtr: z.number().min(0.5).max(20),
  minAvgTurnover: z.number().min(0),
  entryValidDays: z.int().min(1).max(30),
  maxVolatility: z.number().min(0.01).max(5),
  allowPullback: z.boolean().default(true),
  minRewardRisk: z.number().min(0.5).max(5).default(1.2),
  regimeSma: z.int().min(0).max(250).default(0),
})

export const memorySearchInput = z.object({
  q: z.string().trim().min(2).max(500),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  before: z.iso.date().optional(),
})

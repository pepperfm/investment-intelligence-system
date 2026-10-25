import type { EvidenceCoverage, EvidenceContext, EvidenceSourceHealth } from '../../shared/types/evidence'
import { z } from 'zod'
import type { EntryScenario, EvidenceItem, ExitScenario, SourceRef, StrategyRules } from '../../shared/types/investment'
import type { Signal } from '../domain/strategies/rules'

export interface TrackStats {
  trades: number
  winRate: number
  avgNetReturn: number
  avgExcessReturn: number
  profitFactor: number | null
  worstDrawdown: number
  /** Share of trades by exit: take_profit = target hit before stop. */
  exits: {
    takeProfit: number
    stopLoss: number
    timeExit: number
  }
}

export type AgentRole = 'market_researcher' | 'hypothesis_analyst' | 'hypothesis_critic' | 'outcome_reviewer'

export interface EvidencePacket {
  mode: 'research' | 'why_not_buy'
  asOf: string
  instrument: {
    symbol: string
    name: string
    sector: string
    lotSize: number
  }
  strategy: {
    id: string
    name: string
    description: string
    version: number
    rules: StrategyRules
  }
  signal: Omit<Signal, 'metrics'>
  metrics: Record<string, number | null>
  benchmark: {
    symbol: string
    momentum20: number | null
    momentum60: number | null
  }
  recentCandles: {
    d: string
    o: number
    h: number
    l: number
    c: number
    v: number
  }[]
  /** Daily closes (oldest first) so SMA/momentum can be reproduced independently. */
  closes: number[]
  trackRecord: {
    note: string
    universe: number
    all: TrackStats
    sameSetup: TrackStats
    sameSymbol: TrackStats
  }
  execution: {
    entry: string
    evaluation: string
    costs: {
      commissionPct: number
      spreadPct: number
      slippagePct: number
    }
  }
  events: {
    id: string
    title: string
    body: string
    publishedAt: string
    sentiment: number | null
    /** How many near-identical headlines were collapsed into this one, and since when. */
    repeats: number
    firstSeen: string
  }[]
  reports: {
    id: string
    period: string
    publishedAt: string
    availableAt?: string
    source?: string
    sourceUrl?: string | null
    documentUrl?: string | null
    metrics: Record<string, number>
  }[]
  memory: {
    id: string
    title: string
    excerpt: string
    availableAt: string
    similarity: number
    /** Outcome of the past idea (win/loss/flat/no_entry), known at asOf. */
    outcome: string | null
  }[]
  macroContext?: EvidenceContext['macroContext']
  issuerFundamentals?: EvidenceContext['issuerFundamentals']
  regulatoryEvents?: EvidenceContext['regulatoryEvents']
  sourceHealth?: EvidenceSourceHealth[]
  issuerIndustry?: import('../domain/evidence/financials').IssuerIndustry
  bankContext?: {
    reports: unknown[]
    regulatory: import('../../shared/types/evidence').RegulatoryIdentitySnapshot | null
  }
  financialComparisons?: ReturnType<typeof import('../domain/evidence/financials').compareFinancialFacts>
  evidenceCoverage?: EvidenceCoverage
  sources: SourceRef[]
}

/** What the critic sees of the draft: claims only — no confidence, no status, no recommendation strength. */
export interface CriticClaims {
  direction: 'long' | 'no_trade'
  thesis: string
  supportingEvidence: EvidenceItem[]
  counterEvidence: EvidenceItem[]
  assumptions: string[]
  invalidationConditions: string[]
  entry: EntryScenario
  exit: ExitScenario
}

export interface OutcomePacket {
  hypothesis: {
    symbol: string
    strategy: string
    direction: string
    thesis: string
    horizonDays: number
    invalidationConditions: string[]
    entry: EntryScenario
    exit: ExitScenario
    criticVerdict: string | null
    userDecision: string
    createdAt: string
  }
  evaluation: Record<string, unknown>
  strategyStats: Record<string, unknown>
}

/** Removes earlier critic judgements from memory excerpts so the critic is not anchored by past reviews. */
export function redactForCritic(packet: EvidencePacket): EvidencePacket {
  return {
    ...packet,
    memory: (packet.memory ?? []).map(m => ({
      ...m,
      excerpt: m.excerpt.split(/(?<=[.!?\n])\s*/).filter(part => !/критик|critic|вердикт|verdict/i.test(part)).join(' '),
    })),
  }
}

type JsonSchema = Record<string, unknown>

const UNSUPPORTED = ['minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum', 'format', 'pattern', '$schema', 'exclusiveMinimum', 'exclusiveMaximum']

/** Strict JSON Schema for structured-output CLIs: every key required, no extra properties, no unsupported keywords. */
export function strictJsonSchema(schema: z.ZodType): JsonSchema {
  const normalize = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(normalize)
    }
    if (!node || typeof node !== 'object') {
      return node
    }
    const result: JsonSchema = {}
    for (const [key, value] of Object.entries(node)) {
      if (!UNSUPPORTED.includes(key)) {
        result[key] = normalize(value)
      }
    }
    if (result.type === 'object' && result.properties) {
      result.required = Object.keys(result.properties as object)
      result.additionalProperties = false
    }
    return result
  }
  return normalize(z.toJSONSchema(schema, { target: 'draft-7' })) as JsonSchema
}

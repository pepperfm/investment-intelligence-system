import { db, schema } from '@nuxthub/db'
import { count, inArray } from 'drizzle-orm'
import type { ProviderHealth } from '../ai/provider'

/** CLI health spawns a process; the sidebar asks often, so keep it for a minute. */
let healthCache: {
  at: number
  key: string
  value: [ProviderHealth, ProviderHealth]
} | null = null

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const config = useRuntimeConfig()
  const { profile, analyst, critic } = await selectedAgentProviders()
  const healthKey = `${profile}:${analyst.id}:${critic.id}`
  if (!healthCache || healthCache.key !== healthKey || Date.now() - healthCache.at > 60_000) {
    healthCache = {
      at: Date.now(),
      key: healthKey,
      value: await Promise.all([analyst.health(), critic.health()]),
    }
  }
  const [analystHealth, criticHealth] = healthCache.value
  const statusRows = await db.select({
    status: schema.hypotheses.status,
    value: count(),
  }).from(schema.hypotheses).groupBy(schema.hypotheses.status)
  const [pendingOrders] = await db.select({ value: count() }).from(schema.orders).where(inArray(schema.orders.status, ['pending_confirmation', 'working']))
  const [activeRuns] = await db.select({ value: count() }).from(schema.analysisRuns).where(inArray(schema.analysisRuns.status, ['queued', 'running']))
  const [hypotheses] = await db.select({ value: count() }).from(schema.hypotheses)
  const [instruments] = await db.select({ value: count() }).from(schema.instruments)
  const [candles] = await db.select({ value: count() }).from(schema.candles)
  const [documents] = await db.select({ value: count() }).from(schema.documents)
  let aiModel = analyst.id as string
  if (analyst.id === 'codex') {
    aiModel = config.codexAnalystModel || config.codexModel || 'default'
  } else if (analyst.id === 'llmost') {
    aiModel = config.llmostAnalystModel
  } else if (analyst.id === 'claude') {
    aiModel = config.claudeModel || 'default'
  }
  return {
    aiProfile: profile,
    aiModel,
    llmost: {
      configured: Boolean(config.llmostApiKey && config.llmostResearcherModel && config.llmostAnalystModel && config.llmostCriticModel && config.llmostReviewerModel),
      roles: [
        {
          role: 'Исследователь',
          model: config.llmostResearcherModel,
          effort: config.llmostResearcherEffort,
        },
        {
          role: 'Аналитик',
          model: config.llmostAnalystModel,
          effort: config.llmostAnalystEffort,
        },
        {
          role: 'Критик',
          model: config.llmostCriticModel,
          effort: config.llmostCriticEffort,
        },
        {
          role: 'Ретроспектива',
          model: config.llmostReviewerModel,
          effort: config.llmostReviewerEffort,
        },
      ],
    },
    mode: 'manual' as const,
    criticGate: true,
    liveTrading: false,
    marketProvider: config.marketProvider,
    finamConfigured: Boolean(config.finamReadSecret),
    embeddingProvider: config.embeddingProvider,
    codex: {
      model: config.codexAnalystModel || config.codexModel || 'default',
      reasoningEffort: config.codexAnalystEffort || config.codexReasoningEffort || 'default',
      roles: [
        {
          role: 'Исследователь',
          model: config.codexResearcherModel,
          effort: config.codexResearcherEffort,
        },
        {
          role: 'Аналитик',
          model: config.codexAnalystModel,
          effort: config.codexAnalystEffort,
        },
        {
          role: 'Критик',
          model: config.codexCriticModel,
          effort: config.codexCriticEffort,
        },
        {
          role: 'Ретроспектива',
          model: config.codexReviewerModel,
          effort: config.codexReviewerEffort,
        },
      ].map(role => ({
        role: role.role,
        model: role.model || config.codexModel || 'default',
        effort: role.effort || config.codexReasoningEffort || 'default',
      })),
    },
    analyst: analystHealth,
    critic: criticHealth,
    byStatus: Object.fromEntries(statusRows.map(r => [r.status, r.value])) as Record<string, number>,
    pendingOrders: pendingOrders!.value,
    activeRuns: activeRuns!.value,
    counts: {
      hypotheses: hypotheses!.value,
      instruments: instruments!.value,
      candles: candles!.value,
      documents: documents!.value,
    },
  }
})

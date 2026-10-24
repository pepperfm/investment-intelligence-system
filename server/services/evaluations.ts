import { db, schema } from '@nuxthub/db'
import { and, desc, eq, inArray, isNull, lte } from 'drizzle-orm'
import { outcomeReviewSchema } from '../../shared/schemas/investment'
import type { NumericRuleKey, StrategyId, StrategyRules } from '../../shared/types/investment'
import type { OutcomePacket } from '../ai/contracts'
import { backtest, walkForwardCompare } from '../domain/evaluations/backtest'
import { aggregateStats, simulateOutcome } from '../domain/evaluations/outcome'
import { canEvaluate } from '../domain/hypotheses/state'
import { benchmarkInstrument, getInstrument, loadCandles } from './market'
import { upsertDocument } from './memory'
import { getCostModel } from './settings'
import { activeVersion, proposeVersion } from './strategies'

const EVALUABLE = ['user_approved', 'user_rejected', 'watching', 'closed', 'ready_for_user', 'needs_review']

/**
 * Evaluates every hypothesis whose horizon has passed in available data.
 * Every scenario is counterfactual, including approved ideas: this simulator does not replay paper executions.
 */
export async function evaluateDue() {
  const costs = await getCostModel()
  const benchmark = await benchmarkInstrument()
  const due = await db.select({ h: schema.hypotheses }).from(schema.hypotheses)
    .leftJoin(schema.hypothesisEvaluations, eq(schema.hypothesisEvaluations.hypothesisId, schema.hypotheses.id))
    .where(and(isNull(schema.hypothesisEvaluations.id), inArray(schema.hypotheses.status, EVALUABLE), lte(schema.hypotheses.evidenceTimestamp, new Date())))
  const results = {
    evaluated: 0,
    pending: 0,
    reviewed: 0,
    reviewErrors: [] as string[],
  }
  for (const { h } of due) {
    if (!canEvaluate(h.status as never)) {
      continue
    }
    const future = await loadCandles(h.instrumentId, { after: h.evidenceTimestamp })
    const benchmarkFuture = benchmark ? await loadCandles(benchmark.id, { after: h.evidenceTimestamp }) : []
    const outcome = simulateOutcome({
      future,
      benchmarkFuture,
      entry: h.entryScenario,
      exit: h.exitScenario,
      costs,
    })
    if (!outcome.complete) {
      results.pending++
      continue
    }
    const decision = await userDecision(h.id)
    const isCounterfactual = true
    const [evaluation] = await db.transaction(async (tx) => {
      const inserted = await tx.insert(schema.hypothesisEvaluations).values({
        hypothesisId: h.id,
        isCounterfactual,
        entered: outcome.entered,
        entryAt: outcome.entryAt ? new Date(outcome.entryAt) : null,
        exitAt: outcome.exitAt ? new Date(outcome.exitAt) : null,
        entryPrice: outcome.entryPrice,
        exitPrice: outcome.exitPrice,
        exitReason: outcome.exitReason,
        grossReturn: outcome.grossReturn,
        netReturn: outcome.netReturn,
        benchmarkReturn: outcome.benchmarkReturn,
        excessReturn: outcome.excessReturn,
        maxDrawdown: outcome.maxDrawdown,
        maxFavorable: outcome.maxFavorable,
        outcome: outcome.outcome,
        costs: outcome.costs,
      }).onConflictDoNothing().returning()
      await tx.update(schema.hypotheses).set({
        status: 'evaluated',
        updatedAt: new Date(),
      }).where(eq(schema.hypotheses.id, h.id))
      await tx.insert(schema.hypothesisEvents).values({
        hypothesisId: h.id,
        type: 'evaluated',
        fromStatus: h.status,
        toStatus: 'evaluated',
        actor: 'system',
        payload: {
          netReturn: outcome.netReturn,
          outcome: outcome.outcome,
          isCounterfactual,
          userDecision: decision,
        },
      })
      return inserted
    })
    results.evaluated++
    if (evaluation) {
      try {
        await reviewOutcome(h.id)
        results.reviewed++
      } catch (error) {
        results.reviewErrors.push(`${h.id.slice(0, 8)}: ${(error as Error).message}`)
      }
    }
  }
  return results
}

async function userDecision(hypothesisId: string) {
  const [event] = await db.select({ toStatus: schema.hypothesisEvents.toStatus }).from(schema.hypothesisEvents)
    .where(and(eq(schema.hypothesisEvents.hypothesisId, hypothesisId), eq(schema.hypothesisEvents.actor, 'user'), inArray(schema.hypothesisEvents.type, ['user_approve', 'user_reject', 'user_watch'])))
    .orderBy(desc(schema.hypothesisEvents.createdAt)).limit(1)
  return event?.toStatus ?? 'no_decision'
}

/** outcome_reviewer: retrospective notes only. Never changes strategies by itself. */
export async function reviewOutcome(hypothesisId: string) {
  const [h] = await db.select().from(schema.hypotheses).where(eq(schema.hypotheses.id, hypothesisId))
  const [evaluation] = await db.select().from(schema.hypothesisEvaluations).where(eq(schema.hypothesisEvaluations.hypothesisId, hypothesisId))
  if (!h || !evaluation) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Evaluation not found',
    })
  }
  const instrument = await getInstrument(h.instrumentId)
  const stats = await strategyStats(h.strategyId as StrategyId)
  const packet: OutcomePacket = {
    hypothesis: {
      symbol: instrument.symbol,
      strategy: h.strategyId,
      direction: h.direction,
      thesis: h.thesis,
      horizonDays: h.horizonDays,
      invalidationConditions: h.invalidationConditions,
      entry: h.entryScenario,
      exit: h.exitScenario,
      criticVerdict: h.criticVerdict,
      userDecision: await userDecision(h.id),
      createdAt: h.evidenceTimestamp.toISOString(),
    },
    evaluation: {
      ...evaluation,
      evaluatedAt: undefined,
    },
    strategyStats: stats,
  }
  const result = await (await agentProvider('analyst')).run({
    role: 'outcome_reviewer',
    task: 'Разбери завершившуюся гипотезу: прогноз против факта, издержки, просадка, сравнение с индексом, уроки. Предложения по правилам — только как предложения.',
    packet,
    schema: outcomeReviewSchema,
  })
  await db.insert(schema.hypothesisReviews).values({
    hypothesisId,
    role: 'outcome',
    provider: result.provider,
    verdict: evaluation.outcome,
    summary: result.output.summary,
    findings: [
      ...result.output.lessons.map(l => ({
        severity: 'info' as const,
        topic: 'Урок',
        detail: l,
        sourceIds: [],
      })),
      ...result.output.processIssues.map(p => ({
        severity: 'warning' as const,
        topic: 'Процесс',
        detail: p,
        sourceIds: [],
      })),
    ],
    missingChecks: [],
    raw: result.output,
    durationMs: result.durationMs,
  })
  await upsertDocument({
    kind: 'retrospective',
    refId: `retro:${hypothesisId}`,
    instrumentId: h.instrumentId,
    strategyId: h.strategyId,
    title: `Ретроспектива ${instrument.ticker} ${h.strategyId}: ${evaluation.outcome} ${(evaluation.netReturn * 100).toFixed(1)}%`,
    content: [result.output.summary, result.output.forecastVsActual, ...result.output.lessons].join('\n'),
    availableAt: evaluation.exitAt ?? new Date(),
  })
  return result.output
}

export async function listEvaluations() {
  const rows = await db.select({
    evaluation: schema.hypothesisEvaluations,
    hypothesisId: schema.hypotheses.id,
    strategyId: schema.hypotheses.strategyId,
    direction: schema.hypotheses.direction,
    thesis: schema.hypotheses.thesis,
    criticVerdict: schema.hypotheses.criticVerdict,
    versionId: schema.hypotheses.strategyVersionId,
    symbol: schema.instruments.symbol,
  }).from(schema.hypothesisEvaluations)
    .innerJoin(schema.hypotheses, eq(schema.hypotheses.id, schema.hypothesisEvaluations.hypothesisId))
    .innerJoin(schema.instruments, eq(schema.instruments.id, schema.hypotheses.instrumentId))
    .orderBy(desc(schema.hypothesisEvaluations.evaluatedAt))
  const decisions = await db.select({
    hypothesisId: schema.hypothesisEvents.hypothesisId,
    toStatus: schema.hypothesisEvents.toStatus,
  }).from(schema.hypothesisEvents)
    .where(and(eq(schema.hypothesisEvents.actor, 'user'), inArray(schema.hypothesisEvents.type, ['user_approve', 'user_reject', 'user_watch'])))
    .orderBy(desc(schema.hypothesisEvents.createdAt))
  const latest = new Map<string, string | null>()
  for (const decision of decisions) {
    if (!latest.has(decision.hypothesisId)) {
      latest.set(decision.hypothesisId, decision.toStatus)
    }
  }
  // Historical evaluations used approval as a proxy for execution. They are
  // scenario simulations too; present them correctly without rewriting history.
  return rows.map(row => ({
    ...row,
    userApproved: latest.get(row.hypothesisId) === 'user_approved',
    evaluation: {
      ...row.evaluation,
      isCounterfactual: true,
    },
  }))
}

/** Scenario statistics: approval is a decision label, never evidence of execution. */
export async function strategyStats(strategyId?: StrategyId) {
  const rows = (await listEvaluations()).filter(r => !strategyId || r.strategyId === strategyId)
  const toStats = (list: typeof rows) => aggregateStats(list.map(r => r.evaluation))
  const longs = rows.filter(r => r.direction === 'long')
  return {
    all: toStats(longs),
    approved: toStats(longs.filter(r => r.userApproved)),
    counterfactual: toStats(longs.filter(r => r.evaluation.isCounterfactual)),
    criticSupported: toStats(longs.filter(r => r.criticVerdict === 'supported')),
    criticDisputed: toStats(longs.filter(r => r.criticVerdict !== 'supported')),
    whyNotBuy: toStats(rows.filter(r => r.direction === 'no_trade')),
    benchmarkAvg: longs.length ? longs.reduce((s, r) => s + r.evaluation.benchmarkReturn, 0) / longs.length : 0,
  }
}

/** With asOf, every series is truncated there: trades that had not closed by then simply do not exist. */
async function backtestUniverse(asOf?: Date) {
  const benchmark = await benchmarkInstrument()
  const equities = await db.select().from(schema.instruments).where(and(eq(schema.instruments.kind, 'equity'), eq(schema.instruments.active, true)))
  const series = await Promise.all(equities.map(async i => ({
    symbol: i.symbol,
    candles: await loadCandles(i.id, { to: asOf }),
  })))
  return {
    series,
    benchmarkCandles: benchmark ? await loadCandles(benchmark.id, { to: asOf }) : [],
  }
}

const trackRecordCache = new Map<string, Promise<ReturnType<typeof backtest>>>()

/** Point-in-time track record of a rule version: used as evidence for analyst and critic, no future data. */
export function trackRecord(strategyId: StrategyId, versionId: string, rules: StrategyRules, asOf: Date) {
  const key = `${strategyId}:${versionId}:${asOf.toISOString()}`
  let result = trackRecordCache.get(key)
  if (!result) {
    if (trackRecordCache.size > 20) {
      trackRecordCache.clear()
    }
    result = (async () => {
      const costs = await getCostModel()
      const { series, benchmarkCandles } = await backtestUniverse(asOf)
      return backtest(strategyId, rules, series, benchmarkCandles, costs)
    })()
    trackRecordCache.set(key, result)
    result.catch(() => trackRecordCache.delete(key))
  }
  return result
}

export async function backtestStrategy(strategyId: StrategyId, rules?: StrategyRules) {
  const version = await activeVersion(strategyId)
  const costs = await getCostModel()
  const { series, benchmarkCandles } = await backtestUniverse()
  const result = backtest(strategyId, rules ?? version.rules, series, benchmarkCandles, costs)
  return {
    stats: result.stats,
    trades: result.trades.slice(-200),
  }
}

export async function compareVersions(strategyId: StrategyId, versionIds: string[]) {
  const versions = await db.select().from(schema.strategyVersions).where(and(eq(schema.strategyVersions.strategyId, strategyId), inArray(schema.strategyVersions.id, versionIds)))
  const costs = await getCostModel()
  const { series, benchmarkCandles } = await backtestUniverse()
  return walkForwardCompare(strategyId, versions.map(v => ({
    label: `v${v.version} (${v.status})`,
    rules: v.rules,
  })), series, benchmarkCandles, costs)
}

const STEP = 0.15
const INTEGER_KEYS = new Set(['horizonDays', 'trendSma', 'slowSma', 'rsiPeriod', 'breakoutLookback', 'momentumLookback', 'atrPeriod', 'entryValidDays'])

/**
 * Aggregates outcome_reviewer suggestions for the active version into a *proposed* version,
 * then checks it walk-forward against the active one. The user decides whether to activate.
 */
export async function proposeFromRetrospectives(strategyId: StrategyId) {
  const active = await activeVersion(strategyId)
  const reviews = await db.select({ raw: schema.hypothesisReviews.raw }).from(schema.hypothesisReviews)
    .innerJoin(schema.hypotheses, eq(schema.hypotheses.id, schema.hypothesisReviews.hypothesisId))
    .where(and(eq(schema.hypothesisReviews.role, 'outcome'), eq(schema.hypotheses.strategyVersionId, active.id)))
  const votes = new Map<string, number>()
  for (const review of reviews) {
    const parsed = outcomeReviewSchema.safeParse(review.raw)
    for (const s of parsed.success ? parsed.data.ruleSuggestions : []) {
      if (s.parameter in active.rules && s.direction !== 'keep') {
        votes.set(s.parameter, (votes.get(s.parameter) ?? 0) + (s.direction === 'increase' ? 1 : -1))
      }
    }
  }
  const minVotes = Math.max(2, Math.ceil(reviews.length * 0.2))
  const changes = [...votes.entries()].filter(([, v]) => Math.abs(v) >= minVotes)
  if (!changes.length) {
    return {
      proposed: null,
      reason: `Недостаточно согласованных предложений (ретроспектив: ${reviews.length}, нужен перевес ≥ ${minVotes})`,
    }
  }
  const rules: StrategyRules = { ...active.rules }
  for (const [key, vote] of changes) {
    const k = key as NumericRuleKey
    if (typeof rules[k] !== 'number') {
      continue
    }
    const value = rules[k] * (1 + Math.sign(vote) * STEP)
    rules[k] = INTEGER_KEYS.has(key) ? Math.max(1, Math.round(value)) : Math.round(value * 1000) / 1000
  }
  const proposed = await proposeVersion(strategyId, rules, `Из ретроспектив (${reviews.length}): ${changes.map(([k, v]) => `${k} ${v > 0 ? '↑' : '↓'}`).join(', ')}`, 'outcome_reviewer')
  const comparison = await compareVersions(strategyId, [active.id, proposed.id])
  return {
    proposed,
    comparison,
  }
}

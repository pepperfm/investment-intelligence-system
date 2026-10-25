import { db, schema } from '@nuxthub/db'
import { and, desc, eq, inArray, lte } from 'drizzle-orm'
import { outcomeReviewSchema } from '../../shared/schemas/investment'
import type { Candle, CostModel, NumericRuleKey, StrategyId, StrategyRules } from '../../shared/types/investment'
import type { ResearchBarSelection } from '../../shared/types/market-data'
import type { OutcomePacket } from '../ai/contracts'
import { backtest, evaluationHash, walkForwardCompare } from '../domain/evaluations/backtest'
import { benchmarkNeed } from '../domain/market/dependencies'
import { aggregateStats, evaluateScenarioDecision, EVALUATION_VERSION } from '../domain/evaluations/outcome'
import { addTradingDays, calendarVersion } from '../domain/market/calendar'
import { inspectBarQuality } from '../domain/market/bar-quality'
import { benchmarkInstrument, getInstrument, loadCandles, loadResearchBars, researchBarSelection, freezeResearchSelection } from './market'
import { researchSessionClock } from '../domain/market/physical-session-clock'
import { upsertDocument } from './memory'
import { getCostModel } from './settings'
import { activeVersion, proposeVersion } from './strategies'

export async function futureEvaluationSelection(original: ResearchBarSelection, computedAt: Date) {
  return freezeResearchSelection({
    ...original,
    auditIds: undefined,
    revisionCutoff: computedAt.toISOString(),
  })
}

const EVALUABLE = ['user_approved', 'user_rejected', 'watching', 'closed', 'ready_for_user', 'needs_review']

/** Manual, deterministic evaluation only. Existing results and hypotheses are never rewritten. */
export async function evaluateDue() {
  return recomputeEvaluations()
}

export async function recomputeEvaluations(hypothesisIds?: string[]) {
  const candidates = await db.select().from(schema.hypotheses).where(and(
    inArray(schema.hypotheses.status, [...EVALUABLE, 'evaluated']),
    lte(schema.hypotheses.evidenceTimestamp, new Date()),
    hypothesisIds?.length ? inArray(schema.hypotheses.id, hypothesisIds) : undefined,
  ))
  const benchmark = await benchmarkInstrument()
  const results = {
    evaluated: 0,
    pending: 0,
    reviewed: 0,
    reviewErrors: [] as string[],
    unchanged: 0,
  }
  for (const h of candidates) {
    const instrument = await getInstrument(h.instrumentId)
    const [snapshot] = h.snapshotId ? await db.select().from(schema.sourceSnapshots).where(eq(schema.sourceSnapshots.id, h.snapshotId)) : []
    const packet = snapshot?.payload as {
      execution?: { costs?: CostModel }
      calendarVersion?: string
      marketData?: { calendarVersion?: string }
    } | undefined
    const scenario = h.marketScenario
    const costs = scenario?.costs ?? packet?.execution?.costs
    const pinnedCalendar = scenario?.calendarVersion ?? packet?.calendarVersion ?? packet?.marketData?.calendarVersion
    const provider = instrument.provider === 'mock' ? 'mock' : 'finam'
    const currentCalendar = calendarVersion({
      provider,
      asOf: h.evidenceTimestamp,
    })
    const now = new Date()
    const entry = scenario?.entry ?? h.entryScenario
    const exit = scenario?.exit ?? h.exitScenario
    const physical = scenario?.researchSelection?.policyId === 'physical_session_v1'
    const horizonBars = (physical && entry.type === 'market_next_open' ? 1 : entry.validDays) + exit.timeExitDays - 1
    let future: Candle[]
    let benchmarkFuture: Candle[]
    let completedFuture: Candle[]
    let issues: string[]
    let actualCalendar = currentCalendar
    let reconstructionAudit: Record<string, unknown> | null = null
    if (physical) {
      // The signal's snapshot stays fixed. Future-only observations get a new, recorded revision.
      const futureSelection = await futureEvaluationSelection(scenario.researchSelection!, now)
      const input = await loadResearchBars({
        instrumentId: h.instrumentId,
        asOf: now,
        after: h.evidenceTimestamp,
        purpose: 'evaluation',
        limit: horizonBars,
        selection: futureSelection,
      })
      const benchmarkInput = benchmark
        ? await loadResearchBars({
            instrumentId: benchmark.id,
            asOf: new Date(Math.min(now.getTime(), Date.parse(input.bars.at(-1)?.earliestUseAt ?? now.toISOString()))),
            after: h.evidenceTimestamp,
            purpose: 'evaluation',
            selection: futureSelection,
          })
        : null
      future = input.bars
      benchmarkFuture = benchmarkInput && benchmarkInput.quality.status !== 'data_quality_blocked' ? benchmarkInput.bars : []
      const clock = researchSessionClock(future, input.provenance, now)
      const confirmed = new Set(clock.completedSessions(h.evidenceTimestamp, now).map(fact => fact.sessionDate))
      completedFuture = future.filter(bar => confirmed.has(bar.physicalSessionDate ?? bar.sessionDate ?? ''))
      actualCalendar = input.quality.calendarVersion
      issues = input.quality.status === 'data_quality_blocked' ? input.quality.issues.filter(issue => !issue.includes('missing_completed_reconciled_bars') && !issue.startsWith('historical_availability_unknown:') && !issue.startsWith('source_adjustment_policy_unknown:')) : []
      if (completedFuture.length !== future.length) {
        issues.push('physical_clock_rejected_confirmed_bars')
      }
      const stableProvenance = (value: typeof input.provenance) => ({
        ...value,
        selection: {
          ...value.selection,
          revisionCutoff: value.observedAt ?? scenario.researchSelection!.revisionCutoff,
        },
      })
      reconstructionAudit = {
        barPolicy: 'physical_session_v1',
        horizonUnit: 'confirmed_sessions',
        reconstruction: true,
        historicalAvailability: 'unknown',
        paperExecution: false,
        note: 'Counterfactual historical market reconstruction. Eligibility uses a conservative finalization buffer, not a verified last-trade or publication time. Source adjustment policy remains unknown.',
        originalSelection: scenario.researchSelection,
        futureProvenance: stableProvenance(input.provenance),
        benchmarkProvenance: benchmarkInput ? stableProvenance(benchmarkInput.provenance) : null,
        researchQuality: input.quality.status,
        limitations: [...input.quality.issues, ...(benchmarkInput?.quality.issues.map(issue => `benchmark:${issue}`) ?? [])],
      }
    } else {
      // Existing logical/legacy hypotheses are never silently reinterpreted as session-based ideas.
      future = (await loadCandles(h.instrumentId, { after: h.evidenceTimestamp })).slice(0, horizonBars)
      benchmarkFuture = benchmark && future.length
        ? await loadCandles(benchmark.id, {
            after: h.evidenceTimestamp,
            to: new Date(future.at(-1)!.ts),
          })
        : []
      const quality = inspectBarQuality(future, {
        dataSource: provider,
        board: instrument.board,
        asOf: now,
      })
      completedFuture = quality.completedBars
      issues = quality.issues.filter(issue => issue !== 'missing_candles')
      let previous = h.evidenceTimestamp
      for (const candle of completedFuture) {
        try {
          const expected = addTradingDays(previous, 1, {
            provider,
            board: instrument.board,
          }).toISOString().slice(0, 10)
          if (candle.ts.slice(0, 10) !== expected) {
            issues.push(`missing_trading_period:${expected}`)
          }
        } catch {
          issues.push('evaluation_calendar_range_unverified')
        }
        previous = new Date(candle.ts)
      }
    }
    if (!costs) {
      issues.push('legacy_cost_model_not_pinned')
    }
    if (!pinnedCalendar) {
      issues.push('legacy_calendar_not_pinned')
    } else if (pinnedCalendar !== actualCalendar) {
      issues.push('calendar_version_mismatch')
    }
    const result = {
      ...evaluateScenarioDecision({
        future: completedFuture,
        benchmarkFuture,
        entry: scenario?.entry ?? h.entryScenario,
        exit: scenario?.exit ?? h.exitScenario,
        // Missing historical costs block evaluation above; zero is never reported as a historical cost model.
        costs: costs ?? {
          commissionPct: 0,
          spreadPct: 0,
          slippagePct: 0,
        },
        recommendation: h.direction === 'no_trade' ? 'no_trade' : 'long',
        evidenceQuality: {
          validationOk: h.validation.ok,
          decisionVerdict: h.criticVerdict,
          semantics: h.semanticVersion === 'legacy' ? 'legacy' as const : 'explicit' as const,
        },
        qualityIssues: issues,
      }),
      futureDataHash: evaluationHash({
        future,
        benchmarkFuture,
      }),
      futureData: {
        candles: future,
        benchmarkCandles: benchmarkFuture,
        provider: physical ? 'moex_iss' : provider,
        board: instrument.board,
      },
      originalSnapshotId: h.snapshotId,
      reconstructionAudit,
    }
    const identity = {
      evaluationVersion: EVALUATION_VERSION,
      calendarVersion: pinnedCalendar ?? 'legacy_unknown',
      costModelHash: evaluationHash(costs ?? { legacy: 'unknown' }),
      sourceSnapshotHash: snapshot?.sha256 ?? 'legacy_unknown',
    }
    const [latest] = await db.select().from(schema.hypothesisEvaluationRevisions)
      .where(eq(schema.hypothesisEvaluationRevisions.hypothesisId, h.id))
      .orderBy(desc(schema.hypothesisEvaluationRevisions.computedAt)).limit(1)
    if (latest && latest.evaluationVersion === identity.evaluationVersion && latest.calendarVersion === identity.calendarVersion
      && latest.costModelHash === identity.costModelHash && latest.sourceSnapshotHash === identity.sourceSnapshotHash
      && evaluationHash(latest.result) === evaluationHash(result)) {
      results.unchanged++
      continue
    }
    await db.insert(schema.hypothesisEvaluationRevisions).values({
      hypothesisId: h.id,
      ...identity,
      result,
    })
    if (result.status === 'evaluated' || result.status === 'not_entered') {
      results.evaluated++
    } else {
      results.pending++
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
  const [revision] = await db.select().from(schema.hypothesisEvaluationRevisions).where(eq(schema.hypothesisEvaluationRevisions.hypothesisId, hypothesisId))
    .orderBy(desc(schema.hypothesisEvaluationRevisions.computedAt)).limit(1)
  if (!h || !revision) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Evaluation not found',
    })
  }
  const resultData = revision.result as unknown as ReturnType<typeof evaluateScenarioDecision>
  if (resultData.status !== 'evaluated') {
    throw createError({
      statusCode: 409,
      statusMessage: 'A completed, versioned scenario is required for retrospective review',
    })
  }
  const evaluation = resultData.scenarioEvaluation
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
      decisionEvaluation: resultData.decisionEvaluation,
      evaluationVersion: revision.evaluationVersion,
      calendarVersion: revision.calendarVersion,
    },
    strategyStats: stats,
  }
  const result = await (await agentProvider('analyst')).run({
    role: 'outcome_reviewer',
    task: 'Разбери условную покупку отдельно от рекомендации. При no_trade сравни деньги 0%, избежанный убыток и упущенный рост; исход одной сделки не доказывает правильность решения. Не придумывай ценовой прогноз. Предложения по правилам — только как предложения.',
    packet,
    schema: outcomeReviewSchema,
  })
  const [storedReview] = await db.insert(schema.hypothesisReviews).values({
    hypothesisId,
    role: 'outcome',
    verdictTarget: 'scenario_and_decision',
    provider: result.provider,
    verdict: evaluation.outcome!,
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
  }).returning({ id: schema.hypothesisReviews.id })
  await db.insert(schema.hypothesisEvents).values({
    hypothesisId,
    type: 'outcome_reviewed',
    actor: 'agent',
    payload: {
      reviewId: storedReview!.id,
      evaluationRevisionId: revision.id,
    },
  })
  await upsertDocument({
    kind: 'retrospective',
    refId: `retro:${hypothesisId}:${revision.id}:${storedReview!.id}`,
    instrumentId: h.instrumentId,
    strategyId: h.strategyId,
    title: `Ретроспектива ${instrument.ticker} ${h.strategyId}: ${evaluation.outcome} ${(evaluation.netReturn! * 100).toFixed(1)}%`,
    content: [result.output.summary, result.output.forecastVsActual, ...result.output.lessons].join('\n'),
    availableAt: new Date(),
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
    verdictTarget: schema.hypotheses.verdictTarget,
    semanticVersion: schema.hypotheses.semanticVersion,
    versionId: schema.hypotheses.strategyVersionId,
    symbol: schema.instruments.symbol,
  }).from(schema.hypothesisEvaluations)
    .innerJoin(schema.hypotheses, eq(schema.hypotheses.id, schema.hypothesisEvaluations.hypothesisId))
    .innerJoin(schema.instruments, eq(schema.instruments.id, schema.hypotheses.instrumentId))
    .orderBy(desc(schema.hypothesisEvaluations.evaluatedAt))
  const revisions = await db.select({
    revision: schema.hypothesisEvaluationRevisions,
    hypothesisId: schema.hypotheses.id,
    strategyId: schema.hypotheses.strategyId,
    direction: schema.hypotheses.direction,
    thesis: schema.hypotheses.thesis,
    criticVerdict: schema.hypotheses.criticVerdict,
    verdictTarget: schema.hypotheses.verdictTarget,
    semanticVersion: schema.hypotheses.semanticVersion,
    versionId: schema.hypotheses.strategyVersionId,
    symbol: schema.instruments.symbol,
  }).from(schema.hypothesisEvaluationRevisions)
    .innerJoin(schema.hypotheses, eq(schema.hypotheses.id, schema.hypothesisEvaluationRevisions.hypothesisId))
    .innerJoin(schema.instruments, eq(schema.instruments.id, schema.hypotheses.instrumentId))
    .orderBy(desc(schema.hypothesisEvaluationRevisions.computedAt))
  const decisions = await db.select({
    hypothesisId: schema.hypothesisEvents.hypothesisId,
    toStatus: schema.hypothesisEvents.toStatus,
  }).from(schema.hypothesisEvents)
    .where(and(eq(schema.hypothesisEvents.actor, 'user'), inArray(schema.hypothesisEvents.type, ['user_approve', 'user_reject', 'user_watch'])))
    .orderBy(desc(schema.hypothesisEvents.createdAt))
  const latestDecision = new Map<string, string | null>()
  for (const decision of decisions) {
    if (!latestDecision.has(decision.hypothesisId)) {
      latestDecision.set(decision.hypothesisId, decision.toStatus)
    }
  }
  const seen = new Set<string>()
  const current = revisions.map(({ revision, ...row }) => {
    const result = revision.result as unknown as ReturnType<typeof evaluateScenarioDecision> & {
      reconstructionAudit?: {
        researchQuality?: string
        reconstruction?: boolean
        note?: string
      }
    }
    const isLatest = !seen.has(row.hypothesisId)
    seen.add(row.hypothesisId)
    return {
      ...row,
      userApproved: latestDecision.get(row.hypothesisId) === 'user_approved',
      isLatest,
      evaluationVersion: revision.evaluationVersion,
      calendarVersion: revision.calendarVersion,
      costModelHash: revision.costModelHash,
      sourceSnapshotHash: revision.sourceSnapshotHash,
      status: result.status,
      issues: result.issues,
      decisionEvaluation: result.decisionEvaluation,
      reconstructionAudit: result.reconstructionAudit ?? null,
      dataQuality: result.reconstructionAudit?.researchQuality ?? (result.status === 'ambiguous_session' ? 'data_quality_blocked' : 'legacy_unknown'),
      evaluation: {
        ...result.scenarioEvaluation,
        id: revision.id,
        hypothesisId: row.hypothesisId,
        evaluatedAt: revision.computedAt,
      },
    }
  })
  return [...current, ...rows.map(row => ({
    ...row,
    userApproved: latestDecision.get(row.hypothesisId) === 'user_approved',
    isLatest: !seen.has(row.hypothesisId),
    evaluationVersion: 'legacy',
    calendarVersion: 'legacy_unknown',
    costModelHash: 'legacy_unknown',
    sourceSnapshotHash: 'legacy_unknown',
    status: 'legacy' as const,
    issues: ['Historical mechanics are not versioned; preserved for audit, excluded from new statistics.'],
    decisionEvaluation: null,
    reconstructionAudit: null,
    dataQuality: 'legacy_unknown',
    evaluation: {
      ...row.evaluation,
      recordedIsCounterfactual: row.evaluation.isCounterfactual,
      isCounterfactual: true as const,
    },
  }))]
}

/** Scenario statistics: approval is a decision label, never evidence of execution. */
export async function strategyStats(strategyId?: StrategyId) {
  const rows = (await listEvaluations()).filter(r => r.isLatest && r.status === 'evaluated' && (!strategyId || r.strategyId === strategyId))
  const toStats = (list: typeof rows) => {
    const benchmarkReturns = list.map(r => r.evaluation.benchmarkReturn).filter((value): value is number => value !== null)
    return {
      ...aggregateStats(list.map(r => ({
        netReturn: r.evaluation.netReturn!,
        excessReturn: r.evaluation.excessReturn,
        maxDrawdown: r.evaluation.maxDrawdown!,
        outcome: r.evaluation.outcome!,
      }))),
      benchmarkCount: benchmarkReturns.length,
      avgBenchmarkReturn: benchmarkReturns.length ? benchmarkReturns.reduce((sum, value) => sum + value, 0) / benchmarkReturns.length : null,
    }
  }
  const longs = rows.filter(r => r.direction === 'long')
  const benchmarkReturns = longs.map(r => r.evaluation.benchmarkReturn).filter((value): value is number => value !== null)
  return {
    includesReconstruction: rows.some(row => row.reconstructionAudit?.reconstruction),
    statisticsMeaning: rows.some(row => row.reconstructionAudit?.reconstruction)
      ? 'Includes counterfactual historical reconstruction with unknown source adjustment/publication policy; not verified evidence of profitable trading.'
      : 'Counterfactual scenario statistics; user approval does not prove execution or decision correctness.',
    all: toStats(longs),
    approved: toStats(longs.filter(r => r.userApproved)),
    counterfactual: toStats(longs.filter(r => r.evaluation.isCounterfactual)),
    criticSupported: toStats(longs.filter(r => r.criticVerdict === 'supported')),
    criticDisputed: toStats(longs.filter(r => r.criticVerdict !== 'supported')),
    whyNotBuy: toStats(rows.filter(r => r.direction === 'no_trade')),
    benchmarkAvg: benchmarkReturns.length ? benchmarkReturns.reduce((sum, value) => sum + value, 0) / benchmarkReturns.length : null,
  }
}

/** A bounded, source-pinned replay can disclose partial universe coverage without fabricating completeness. */
export async function backtestUniverse(asOf = new Date(), selection: ResearchBarSelection = researchBarSelection(), rules?: StrategyRules) {
  selection = selection.auditIds ? selection : await freezeResearchSelection(selection)
  const benchmark = await benchmarkInstrument()
  const equities = await db.select().from(schema.instruments).where(and(eq(schema.instruments.kind, 'equity'), eq(schema.instruments.active, true)))
  const load = async (instrument: typeof equities[number]) => {
    try {
      const input = await loadResearchBars({
        instrumentId: instrument.id,
        asOf,
        purpose: 'backtest',
        selection,
      })
      return {
        symbol: instrument.symbol,
        ...input,
        error: null,
      }
    } catch (error) {
      return {
        symbol: instrument.symbol,
        bars: [] as Candle[],
        quality: null,
        provenance: null,
        gaps: [],
        error: error instanceof Error ? error.message : 'research_series_load_failed',
      }
    }
  }
  const rawSeries = await Promise.all(equities.map(load))
  const checkedBenchmark = benchmark ? await load(benchmark) : null
  const usable = rawSeries.filter(row => row.quality?.status !== 'data_quality_blocked' && row.bars.length > 0 && !row.error)
  const excludedSymbols = rawSeries.filter(row => !usable.includes(row)).map(row => row.symbol)
  const benchmarkUsable = checkedBenchmark && checkedBenchmark.quality?.status !== 'data_quality_blocked' && checkedBenchmark.bars.length > 0 && !checkedBenchmark.error
  const issues = rawSeries.flatMap(row => [...(row.quality?.issues ?? []), ...(row.error ? [row.error] : [])].map(issue => `${row.symbol}:${issue}`))
  if (checkedBenchmark) {
    issues.push(...[...(checkedBenchmark.quality?.issues ?? []), ...(checkedBenchmark.error ? [checkedBenchmark.error] : [])].map(issue => `benchmark:${issue}`))
  } else {
    issues.push('benchmark_missing')
  }
  if (excludedSymbols.length) {
    issues.push(`partial_universe_excluded:${excludedSymbols.join(',')}`)
  }
  const requiredBenchmarkBlocked = rules && benchmarkNeed(rules) === 'required_for_signal' && !benchmarkUsable
  const allVerified = !excludedSymbols.length && !!benchmarkUsable && usable.every(row => row.quality?.status === 'verified') && checkedBenchmark?.quality?.status === 'verified'
  return {
    series: (requiredBenchmarkBlocked ? [] : usable).map(row => ({
      symbol: row.symbol,
      candles: row.bars,
    })),
    benchmarkCandles: benchmarkUsable ? checkedBenchmark.bars : [],
    dataQuality: {
      status: !usable.length || requiredBenchmarkBlocked ? 'data_quality_blocked' as const : allVerified ? 'verified' as const : 'research_usable_with_limits' as const,
      issues: [...new Set(issues)],
      absoluteInputVerified: usable.length > 0 && usable.every(row => row.quality?.status === 'verified'),
      benchmarkRelativeVerified: !!benchmarkUsable && checkedBenchmark.quality?.status === 'verified',
      benchmarkQuality: benchmarkUsable ? checkedBenchmark.quality!.status : 'benchmark_unavailable',
      benchmarkUnavailableReason: benchmarkUsable ? null : checkedBenchmark?.quality?.issues.join('; ') ?? 'benchmark_missing',
      signalEligibility: requiredBenchmarkBlocked ? 'blocked' : 'eligible',
      excludedSymbols,
      includedSymbols: usable.map(row => row.symbol),
      selection,
      statisticsMeaning: allVerified ? 'Verified input series; statistical limitations still apply.' : 'Exploratory reconstruction/partial-universe statistics, not verified profitable-strategy evidence.',
    },
    rawInput: {
      selection,
      series: rawSeries.map(({ symbol, bars, quality, provenance, error }) => ({
        symbol,
        candles: bars,
        quality,
        provenance,
        error,
      })),
      benchmark: checkedBenchmark,
    },
  }
}

type UniverseInput = Awaited<ReturnType<typeof backtestUniverse>>
type TrackRecordResult = ReturnType<typeof backtest> & {
  dataQuality: UniverseInput['dataQuality']
  audit: ReturnType<typeof backtest>['audit'] & {
    dataQuality: UniverseInput['dataQuality']
    rawInput: UniverseInput['rawInput']
    rawInputHash: string
    strategyVersionId: string
    asOf: string
  }
}
const trackRecordCache = new Map<string, Promise<TrackRecordResult>>()

/** Point-in-time track record of a rule version: used as evidence for analyst and critic, no future data. */
export async function trackRecord(strategyId: StrategyId, versionId: string, rules: StrategyRules, asOf: Date, pinnedCosts?: CostModel, selection?: ResearchBarSelection) {
  const costs = pinnedCosts ?? await getCostModel()
  const { series, benchmarkCandles, dataQuality, rawInput } = await backtestUniverse(asOf, selection, rules)
  const key = evaluationHash({
    strategyId,
    versionId,
    rules,
    asOf: asOf.toISOString(),
    costs,
    series,
    benchmarkCandles,
    dataQuality,
    rawInput,
  })
  let result = trackRecordCache.get(key)
  if (!result) {
    if (trackRecordCache.size > 20) {
      trackRecordCache.clear()
    }
    result = (async () => {
      const computed = backtest(strategyId, rules, series, benchmarkCandles, costs)
      return {
        ...computed,
        dataQuality,
        audit: {
          ...computed.audit,
          dataQuality,
          rawInput,
          rawInputHash: evaluationHash(rawInput),
          strategyVersionId: versionId,
          asOf: asOf.toISOString(),
        },
      }
    })()
    trackRecordCache.set(key, result)
    result.catch(() => trackRecordCache.delete(key))
  }
  return result
}

export async function backtestStrategy(strategyId: StrategyId, rules?: StrategyRules) {
  const version = await activeVersion(strategyId)
  const costs = await getCostModel()
  const { series, benchmarkCandles, dataQuality } = await backtestUniverse(new Date(), researchBarSelection(), rules ?? version.rules)
  const result = backtest(strategyId, rules ?? version.rules, series, benchmarkCandles, costs)
  return {
    dataQuality,
    stats: result.stats,
    trades: result.trades.slice(-200),
    audit: result.audit,
  }
}

export async function compareVersions(strategyId: StrategyId, versionIds: string[]) {
  const versions = await db.select().from(schema.strategyVersions).where(and(eq(schema.strategyVersions.strategyId, strategyId), inArray(schema.strategyVersions.id, versionIds)))
  const costs = await getCostModel()
  const { series, benchmarkCandles, dataQuality } = await backtestUniverse()
  return {
    dataQuality,
    ...walkForwardCompare(strategyId, versions.map(v => ({
      label: `v${v.version} (${v.status})`,
      rules: v.rules,
    })), series, benchmarkCandles, costs),
  }
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

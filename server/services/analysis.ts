import { createHash } from 'node:crypto'
import { db, schema } from '@nuxthub/db'
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { analystOutputSchema, criticOutputSchema, researchOutputSchema, type AnalystOutput, type StartRunInput } from '../../shared/schemas/investment'
import { DEFAULT_MIN_REWARD_RISK, type EntryScenario, type ExitScenario, type HypothesisStatus, type RunLogEntry, type SourceRef, type StrategyId, type StrategyRules } from '../../shared/types/investment'
import { redactForCritic, type CriticClaims, type EvidencePacket, type TrackStats } from '../ai/contracts'
import { aggregateStats } from '../domain/evaluations/outcome'
import { balanceByOutcome, dedupeEvents } from '../domain/memory/selection'
import { addTradingDays, isTradingDay, startOfUtcDay } from '../domain/market/calendar'
import { computeMetrics } from '../domain/market/indicators'
import { gateStatus } from '../domain/hypotheses/state'
import { validateHypothesis } from '../domain/hypotheses/validation'
import { STRATEGY_INFO, evaluateSignal } from '../domain/strategies/rules'
import { benchmarkInstrument, getInstrument, loadCandles, syncCandles, syncFundamentals } from './market'
import { searchMemory, upsertDocument } from './memory'
import { trackRecord } from './evaluations'
import { getCostModel } from './settings'
import { activeVersion } from './strategies'

const MAX_STALE_DAYS = 5
const ANALYST_VERSION = 'pipeline-v1'
const CONCURRENCY = 2

export async function startRun(userId: string, input: StartRunInput) {
  const asOf = input.asOf ? endOfDay(new Date(input.asOf)) : new Date()
  if (asOf.getTime() > Date.now() + 60_000) {
    throw createError({
      statusCode: 400,
      statusMessage: 'asOf cannot be in the future',
    })
  }
  const versions: Record<string, number> = {}
  for (const strategy of input.strategies) {
    versions[strategy] = (await activeVersion(strategy)).version
  }
  const [run] = await db.insert(schema.analysisRuns).values({
    userId,
    kind: input.kind,
    strategies: input.strategies,
    instrumentIds: input.instrumentIds,
    asOf,
    status: 'queued',
    provider: agentProvider('analyst').id,
    criticProvider: agentProvider('critic').id,
    rulesVersions: versions,
  }).returning()
  // Runs only on explicit user command; the process keeps state in the database.
  void executeRun(run!.id).catch(error => console.error('Analysis run crashed', run!.id, (error as Error).message))
  return run!
}

/** End of the trading calendar day in Moscow time (UTC+3), after the evening session. */
function endOfDay(date: Date) {
  return new Date(startOfUtcDay(date).getTime() + 21 * 3_600_000 - 1000)
}

class RunLogger {
  entries: RunLogEntry[] = []
  constructor(private readonly runId: string) {}
  async log(level: RunLogEntry['level'], message: string) {
    this.entries.push({
      at: new Date().toISOString(),
      level,
      message,
    })
    await db.update(schema.analysisRuns).set({ log: this.entries }).where(eq(schema.analysisRuns.id, this.runId))
  }
}

export async function executeRun(runId: string) {
  const [run] = await db.select().from(schema.analysisRuns).where(eq(schema.analysisRuns.id, runId))
  if (!run || run.status !== 'queued') {
    return
  }
  const logger = new RunLogger(runId)
  await db.update(schema.analysisRuns).set({
    status: 'running',
    startedAt: new Date(),
  }).where(eq(schema.analysisRuns.id, runId))
  const summary = {
    candidates: 0,
    screenedOut: [] as {
      symbol: string
      strategy: string
      reasons: string[]
    }[],
    hypotheses: [] as {
      id: string
      symbol: string
      strategy: string
      status: string
    }[],
    failures: [] as {
      symbol: string
      strategy: string
      error: string
    }[],
  }
  try {
    const isLive = Date.now() - run.asOf.getTime() < 86_400_000
    const benchmark = await benchmarkInstrument()
    if (isLive) {
      await logger.log('info', 'Обновление котировок и событий перед анализом')
      for (const id of [...run.instrumentIds, ...(benchmark ? [benchmark.id] : [])]) {
        await syncCandles(id)
        await syncFundamentals(id)
      }
    } else {
      await logger.log('info', `Анализ на дату ${run.asOf.toISOString().slice(0, 10)}: используются только данные, доступные к этому моменту`)
    }
    const tasks = run.instrumentIds.flatMap(instrumentId => (run.strategies as StrategyId[]).map(strategy => ({
      instrumentId,
      strategy,
    })))
    summary.candidates = tasks.length
    let cursor = 0
    const worker = async () => {
      while (cursor < tasks.length) {
        const task = tasks[cursor++]!
        try {
          const result = await analyseCandidate(run, task.instrumentId, task.strategy, benchmark?.id ?? null, logger)
          if (result.kind === 'screened') {
            summary.screenedOut.push(result.entry)
          } else {
            summary.hypotheses.push(result.entry)
          }
        } catch (error) {
          const instrument = await getInstrument(task.instrumentId)
          summary.failures.push({
            symbol: instrument.symbol,
            strategy: task.strategy,
            error: (error as Error).message,
          })
          await logger.log('error', `${instrument.symbol}/${task.strategy}: ${(error as Error).message}`)
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    await logger.log('info', `Готово: гипотез ${summary.hypotheses.length}, отсеяно ${summary.screenedOut.length}, ошибок ${summary.failures.length}`)
    await db.update(schema.analysisRuns).set({
      status: summary.failures.length === tasks.length && tasks.length > 0 ? 'failed' : 'completed',
      summary,
      finishedAt: new Date(),
      error: summary.failures.length === tasks.length && tasks.length > 0 ? 'Все кандидаты завершились ошибкой' : null,
    }).where(eq(schema.analysisRuns.id, runId))
  } catch (error) {
    await logger.log('error', (error as Error).message)
    await db.update(schema.analysisRuns).set({
      status: 'failed',
      summary,
      error: (error as Error).message,
      finishedAt: new Date(),
    }).where(eq(schema.analysisRuns.id, runId))
  }
}

type Run = typeof schema.analysisRuns.$inferSelect

export async function buildEvidencePacket(run: Pick<Run, 'id' | 'kind' | 'asOf'>, instrumentId: string, strategy: StrategyId, benchmarkId: string | null) {
  const instrument = await getInstrument(instrumentId)
  const version = await activeVersion(strategy)
  const candles = await loadCandles(instrumentId, {
    to: run.asOf,
    limit: 400,
  })
  const benchmarkCandles = benchmarkId
    ? await loadCandles(benchmarkId, {
        to: run.asOf,
        limit: 300,
      })
    : []
  const benchmarkMetrics = computeMetrics(benchmarkCandles)
  const signal = evaluateSignal(strategy, version.rules, candles, benchmarkCandles)
  const windowStart = new Date(run.asOf.getTime() - 90 * 86_400_000)
  const rawEvents = await db.select().from(schema.marketEvents).where(and(eq(schema.marketEvents.instrumentId, instrumentId), lte(schema.marketEvents.publishedAt, run.asOf), lte(schema.marketEvents.retrievedAt, run.asOf), gte(schema.marketEvents.publishedAt, windowStart))).orderBy(desc(schema.marketEvents.publishedAt)).limit(40)
  const events = dedupeEvents(rawEvents).slice(0, 10)
  const reportRows = await db.select().from(schema.issuerReports).where(and(eq(schema.issuerReports.instrumentId, instrumentId), lte(schema.issuerReports.publishedAt, run.asOf), lte(schema.issuerReports.availableAt, run.asOf))).orderBy(desc(schema.issuerReports.publishedAt), desc(schema.issuerReports.availableAt))
  const seenPeriods = new Set<string>()
  const reports = reportRows.filter((report) => {
    const key = `${report.reportType}:${report.period}`
    if (seenPeriods.has(key)) {
      return false
    }
    seenPeriods.add(key)
    return true
  }).slice(0, 4)
  const situation = `${instrument.name} ${instrument.sector} ${STRATEGY_INFO[strategy].name} ${signal.setupType} ${signal.reasons.join(' ')} ${signal.failures.join(' ')}`
  // Only resolved situations (retrospectives with real outcomes): open ideas and their critic verdicts would anchor.
  const candidates = await searchMemory(situation, {
    before: run.asOf,
    kinds: ['retrospective'],
    limit: 20,
  })
  const outcomeRows = candidates.length
    ? await db.select({
        hypothesisId: schema.hypothesisEvaluations.hypothesisId,
        outcome: schema.hypothesisEvaluations.outcome,
      }).from(schema.hypothesisEvaluations).where(inArray(schema.hypothesisEvaluations.hypothesisId, candidates.map(m => m.refId.replace(/^retro:/, ''))))
    : []
  const outcomes = new Map(outcomeRows.map(r => [r.hypothesisId, r.outcome]))
  const memory = balanceByOutcome(candidates.map(m => ({
    ...m,
    outcome: outcomes.get(m.refId.replace(/^retro:/, '')) ?? null,
  })), 5)
  const [record, costs] = await Promise.all([trackRecord(strategy, version.id, version.rules, run.asOf), getCostModel()])
  const sameSetup = record.trades.filter(t => t.setupType === signal.setupType)
  const sameSymbol = record.trades.filter(t => t.symbol === instrument.symbol)
  const lastTs = candles.at(-1)?.ts ?? run.asOf.toISOString()
  const sources: SourceRef[] = [
    {
      id: 'candles',
      kind: 'candles',
      title: `Дневные свечи ${instrument.symbol} (${candles.length} шт.)`,
      url: null,
      asOf: lastTs,
    },
    {
      id: 'metrics',
      kind: 'metrics',
      title: 'Индикаторы и сигнал стратегии (рассчитаны кодом)',
      url: null,
      asOf: lastTs,
    },
    {
      id: 'track',
      kind: 'backtest',
      title: `Point-in-time бэктест ${STRATEGY_INFO[strategy].name} v${version.version} (${record.trades.length} сделок)`,
      url: null,
      asOf: lastTs,
    },
    ...events.map(({ event: e }) => ({
      id: `ev:${e.id.slice(0, 8)}`,
      kind: 'event' as const,
      title: e.title,
      url: e.url,
      asOf: e.publishedAt.toISOString(),
    })),
    ...reports.map(r => ({
      id: `rep:${r.id.slice(0, 8)}`,
      kind: 'report' as const,
      title: `${r.reportType} ${r.period}`,
      url: r.url,
      asOf: r.publishedAt.toISOString(),
    })),
    ...memory.map(m => ({
      id: `mem:${m.id.slice(0, 8)}`,
      kind: 'memory' as const,
      title: m.title,
      url: null,
      asOf: m.availableAt.toISOString(),
    })),
  ]
  const { metrics, ...signalRest } = signal
  const packet: EvidencePacket = {
    mode: run.kind === 'why_not_buy' ? 'why_not_buy' : 'research',
    asOf: run.asOf.toISOString(),
    instrument: {
      symbol: instrument.symbol,
      name: instrument.name,
      sector: instrument.sector,
      lotSize: instrument.lotSize,
    },
    strategy: {
      id: strategy,
      name: STRATEGY_INFO[strategy].name,
      description: STRATEGY_INFO[strategy].description,
      version: version.version,
      rules: activeRuleSet(strategy, version.rules),
    },
    signal: signalRest,
    metrics: roundMetrics(metrics),
    benchmark: {
      symbol: marketProvider().benchmarkSymbol,
      momentum20: benchmarkMetrics.momentum20,
      momentum60: benchmarkMetrics.momentum60,
    },
    closes: candles.slice(-260).map(c => c.close),
    trackRecord: {
      note: `Бэктест активной версии правил по вселенной до ${run.asOf.toISOString().slice(0, 10)}: только сделки, закрытые до этой даты; издержки вычтены. Прошлое не гарантирует будущего.`,
      universe: new Set(record.trades.map(t => t.symbol)).size,
      all: trackStats(record.trades),
      sameSetup: trackStats(sameSetup),
      sameSymbol: trackStats(sameSymbol),
    },
    execution: {
      entry: `Последняя завершённая сессия — ${lastTs.slice(0, 10)}${isTradingDay(run.asOf) ? '' : ` (дата анализа ${run.asOf.toISOString().slice(0, 10)} — неторговый день, это нормально)`}; вход по открытию следующей сессии ${addTradingDays(new Date(lastTs), 1).toISOString().slice(0, 10)}. Стоп и цель зафиксированы в абсолютных ценах от последнего закрытия: при гэпе на открытии фактическое отношение прибыль/риск отличается от расчётного.`,
      evaluation: 'Исход считает код: при касании стопа и цели в один день — стоп; гэп через стоп исполняется по открытию; выход по времени — закрытие последнего дня горизонта.',
      costs,
    },
    recentCandles: candles.slice(-60).map(c => ({
      d: c.ts.slice(0, 10),
      o: c.open,
      h: c.high,
      l: c.low,
      c: c.close,
      v: c.volume,
    })),
    events: events.map(({ event: e, repeats, firstSeen }) => ({
      id: `ev:${e.id.slice(0, 8)}`,
      title: e.title,
      body: e.body,
      publishedAt: e.publishedAt.toISOString(),
      sentiment: e.sentiment,
      repeats,
      firstSeen: firstSeen.toISOString(),
    })),
    reports: reports.map(r => ({
      id: `rep:${r.id.slice(0, 8)}`,
      period: r.period,
      publishedAt: r.publishedAt.toISOString(),
      availableAt: r.availableAt.toISOString(),
      source: r.source,
      sourceUrl: r.url,
      documentUrl: r.documentUrl,
      metrics: r.metrics,
    })),
    memory: memory.map(m => ({
      id: `mem:${m.id.slice(0, 8)}`,
      title: m.title,
      excerpt: m.content.slice(0, 600),
      availableAt: m.availableAt.toISOString(),
      similarity: Math.round(m.similarity * 1000) / 1000,
      outcome: m.outcome,
    })),
    sources,
  }
  return {
    packet,
    signal,
    version,
    instrument,
    lastCandleTs: candles.at(-1)?.ts,
  }
}

/** Rules shown to agents: parameters that this version never evaluates are dropped so they cannot be misread as filters. */
function activeRuleSet(strategy: StrategyId, rules: StrategyRules): StrategyRules {
  if (strategy === 'swing' && rules.allowPullback === false) {
    const { rsiMin: _min, rsiMax: _max, ...rest } = rules
    return rest as StrategyRules
  }
  return rules
}

function trackStats(trades: {
  netReturn: number
  excessReturn: number
  maxDrawdown: number
  outcome: string
  exitReason: string
}[]): TrackStats {
  const stats = aggregateStats(trades)
  const r = (v: number) => Math.round(v * 10_000) / 10_000
  const share = (reason: string) => trades.length ? trades.filter(t => t.exitReason === reason).length / trades.length : 0
  return {
    trades: stats.traded,
    winRate: r(stats.winRate),
    avgNetReturn: r(stats.avgNetReturn),
    avgExcessReturn: r(stats.avgExcessReturn),
    profitFactor: Number.isFinite(stats.profitFactor) ? r(stats.profitFactor) : null,
    worstDrawdown: r(stats.worstDrawdown),
    exits: {
      takeProfit: r(share('take_profit')),
      stopLoss: r(share('stop_loss')),
      timeExit: r(share('time_exit')),
    },
  }
}

function roundMetrics(metrics: Record<string, number | null>) {
  return Object.fromEntries(Object.entries(metrics).map(([k, v]) => [k, v === null ? null : Math.round(v * 10_000) / 10_000]))
}

function sha256(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

async function analyseCandidate(run: Run, instrumentId: string, strategy: StrategyId, benchmarkId: string | null, logger: RunLogger) {
  const { packet, signal, version, instrument, lastCandleTs } = await buildEvidencePacket(run, instrumentId, strategy, benchmarkId)
  const label = `${instrument.symbol}/${strategy}`
  const [snapshot] = await db.insert(schema.sourceSnapshots).values({
    runId: run.id,
    instrumentId,
    kind: 'evidence_packet',
    payload: packet,
    sha256: sha256(packet),
    asOf: run.asOf,
  }).returning({ id: schema.sourceSnapshots.id })
  if (run.kind === 'research' && !signal.setup) {
    await logger.log('info', `${label}: отсеян скринингом — ${signal.failures.join('; ')}`)
    return {
      kind: 'screened' as const,
      entry: {
        symbol: instrument.symbol,
        strategy,
        reasons: signal.failures,
      },
    }
  }
  const analyst = agentProvider('analyst')
  await logger.log('info', `${label}: market_researcher (${analyst.id})`)
  const research = await analyst.run({
    role: 'market_researcher',
    task: `Исследуй ${instrument.name} (${instrument.symbol}) для стратегии ${STRATEGY_INFO[strategy].name}, горизонт ${version.rules.horizonDays} торговых дней, на момент ${packet.asOf}.`,
    packet,
    schema: researchOutputSchema,
  })
  await logger.log('info', `${label}: корневой аналитик формулирует гипотезу`)
  const draft = await analyst.run({
    role: 'hypothesis_analyst',
    task: run.kind === 'why_not_buy'
      ? `Режим why_not_buy: объясни, почему покупка ${instrument.symbol} сейчас не обоснована по стратегии ${STRATEGY_INFO[strategy].name} (или честно признай, что обоснована).`
      : `Сформулируй одну опровержимую гипотезу по ${instrument.symbol} для стратегии ${STRATEGY_INFO[strategy].name}.`,
    packet: {
      evidence: packet,
      research: research.output,
    },
    schema: analystOutputSchema,
  })
  const entry: EntryScenario = {
    type: 'market_next_open',
    price: signal.entry ?? packet.metrics.close ?? 0,
    validDays: version.rules.entryValidDays,
    note: draft.output.entryNote,
  }
  const exit: ExitScenario = {
    stopLoss: signal.stopLoss ?? 0,
    takeProfit: signal.takeProfit ?? 0,
    timeExitDays: version.rules.horizonDays,
    note: draft.output.exitNote,
  }
  const validation = validateHypothesis({
    draft: draft.output,
    entry,
    exit,
    sources: packet.sources,
    lastCandleTs,
    asOf: run.asOf,
    maxStaleDays: MAX_STALE_DAYS,
    rewardRisk: signal.rewardRisk,
    minRewardRisk: version.rules.minRewardRisk ?? DEFAULT_MIN_REWARD_RISK,
  })
  const hypothesis = await insertHypothesis(run, {
    instrumentId,
    strategy,
    versionId: version.id,
    snapshotId: snapshot!.id,
    draft: draft.output,
    entry,
    exit,
    packet,
    validation,
    analystProvider: analyst.id,
    researchDataGaps: research.output.dataGaps,
  })
  await logger.log('info', `${label}: гипотеза ${hypothesis.id.slice(0, 8)} → hypothesis_critic`)
  const status = await runCritic(hypothesis.id, logger)
  return {
    kind: 'hypothesis' as const,
    entry: {
      id: hypothesis.id,
      symbol: instrument.symbol,
      strategy,
      status,
    },
  }
}

interface InsertInput {
  instrumentId: string
  strategy: StrategyId
  versionId: string
  snapshotId: string
  draft: AnalystOutput
  entry: EntryScenario
  exit: ExitScenario
  packet: EvidencePacket
  validation: {
    ok: boolean
    issues: string[]
  }
  analystProvider: string
  researchDataGaps: string[]
}

async function insertHypothesis(run: Run, input: InsertInput) {
  const { draft } = input
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(schema.hypotheses).values({
      runId: run.id,
      instrumentId: input.instrumentId,
      strategyId: input.strategy,
      strategyVersionId: input.versionId,
      snapshotId: input.snapshotId,
      direction: draft.direction,
      horizonDays: input.exit.timeExitDays,
      thesis: draft.thesis,
      supportingEvidence: draft.supportingEvidence,
      counterEvidence: draft.counterEvidence,
      assumptions: draft.assumptions,
      invalidationConditions: draft.invalidationConditions,
      entryScenario: input.entry,
      exitScenario: input.exit,
      riskNotes: [...draft.riskNotes, ...input.researchDataGaps.map(g => `Пробел данных: ${g}`)],
      alternatives: draft.alternatives,
      sources: input.packet.sources,
      metrics: input.packet.metrics,
      validation: input.validation,
      confidence: draft.confidence,
      evidenceTimestamp: run.asOf,
      checkAt: addTradingDays(run.asOf, input.exit.timeExitDays + input.entry.validDays),
      status: 'awaiting_critic',
      analystProvider: input.analystProvider,
      analystVersion: ANALYST_VERSION,
    }).returning()
    await tx.insert(schema.hypothesisEvents).values({
      hypothesisId: row!.id,
      type: 'created',
      toStatus: 'awaiting_critic',
      actor: 'agent',
      payload: {
        runId: run.id,
        validation: input.validation,
      },
    })
    return row!
  })
}

/**
 * Independent critic. It receives its own evidence packet (rebuilt from the immutable snapshot)
 * and the claims only — never the analyst's confidence or the pipeline's preliminary status.
 */
export async function runCritic(hypothesisId: string, logger?: RunLogger): Promise<HypothesisStatus> {
  const [h] = await db.select().from(schema.hypotheses).where(eq(schema.hypotheses.id, hypothesisId))
  if (!h) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Hypothesis not found',
    })
  }
  if (!['awaiting_critic', 'needs_review'].includes(h.status)) {
    throw createError({
      statusCode: 409,
      statusMessage: `Critic cannot run in status ${h.status}`,
    })
  }
  const [snapshot] = h.snapshotId ? await db.select().from(schema.sourceSnapshots).where(eq(schema.sourceSnapshots.id, h.snapshotId)) : []
  if (!snapshot) {
    throw new Error('Evidence snapshot missing')
  }
  const evidence = redactForCritic(structuredClone(snapshot.payload) as EvidencePacket)
  const claims: CriticClaims = {
    direction: h.direction as CriticClaims['direction'],
    thesis: h.thesis,
    supportingEvidence: h.supportingEvidence,
    counterEvidence: h.counterEvidence,
    assumptions: h.assumptions,
    invalidationConditions: h.invalidationConditions,
    entry: h.entryScenario,
    exit: h.exitScenario,
  }
  const critic = agentProvider('critic')
  const started = Date.now()
  try {
    const result = await critic.run({
      role: 'hypothesis_critic',
      task: 'Независимо оцени гипотезу по собственному пакету данных. Найди опровергающие факты и пробелы. Вынеси вердикт достаточности доказательств.',
      packet: {
        evidence,
        claims,
      },
      schema: criticOutputSchema,
    })
    const status = gateStatus({
      criticVerdict: result.output.verdict,
      criticSucceeded: true,
      validationOk: h.validation.ok,
    })
    await db.transaction(async (tx) => {
      await tx.insert(schema.hypothesisReviews).values({
        hypothesisId,
        role: 'critic',
        provider: result.provider,
        verdict: result.output.verdict,
        summary: result.output.summary,
        findings: result.output.findings,
        missingChecks: result.output.missingChecks,
        raw: result.raw,
        durationMs: result.durationMs,
      })
      await tx.update(schema.hypotheses).set({
        status,
        criticVerdict: result.output.verdict,
        criticFindings: result.output.findings,
        updatedAt: new Date(),
      }).where(eq(schema.hypotheses.id, hypothesisId))
      await tx.insert(schema.hypothesisEvents).values({
        hypothesisId,
        type: 'critic_completed',
        fromStatus: h.status,
        toStatus: status,
        actor: 'agent',
        payload: {
          verdict: result.output.verdict,
          provider: result.provider,
          validationOk: h.validation.ok,
        },
      })
    })
    const instrument = await getInstrument(h.instrumentId)
    await upsertDocument({
      kind: 'hypothesis',
      refId: `${h.runId}:${h.id}`,
      instrumentId: h.instrumentId,
      strategyId: h.strategyId,
      title: `${instrument.ticker} ${h.strategyId} ${h.direction}: ${h.thesis.slice(0, 120)}`,
      content: [
        h.thesis,
        `Критик: ${result.output.verdict}. ${result.output.summary}`,
        `Аргументы против: ${h.counterEvidence.map(e => e.claim).join('; ')}`,
      ].join('\n'),
      availableAt: h.evidenceTimestamp,
    })
    await logger?.log('info', `${instrument.symbol}/${h.strategyId}: критик → ${result.output.verdict}, статус ${status}`)
    return status
  } catch (error) {
    await db.insert(schema.hypothesisEvents).values({
      hypothesisId,
      type: 'critic_failed',
      fromStatus: h.status,
      toStatus: h.status,
      actor: 'system',
      comment: (error as Error).message.slice(0, 2000),
      payload: {
        provider: critic.id,
        durationMs: Date.now() - started,
      },
    })
    await logger?.log('warn', `Критик не отработал для ${hypothesisId.slice(0, 8)}: ${(error as Error).message}. Гипотеза остаётся в awaiting_critic.`)
    return h.status as HypothesisStatus
  }
}

export async function listRuns(limit = 50) {
  return db.select().from(schema.analysisRuns).orderBy(desc(schema.analysisRuns.createdAt)).limit(limit)
}

export async function getRun(id: string) {
  const [run] = await db.select().from(schema.analysisRuns).where(eq(schema.analysisRuns.id, id))
  if (!run) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Run not found',
    })
  }
  const hypotheses = await db.select({
    id: schema.hypotheses.id,
    status: schema.hypotheses.status,
    direction: schema.hypotheses.direction,
    strategyId: schema.hypotheses.strategyId,
    thesis: schema.hypotheses.thesis,
    confidence: schema.hypotheses.confidence,
    criticVerdict: schema.hypotheses.criticVerdict,
    symbol: schema.instruments.symbol,
    name: schema.instruments.name,
  }).from(schema.hypotheses).innerJoin(schema.instruments, eq(schema.instruments.id, schema.hypotheses.instrumentId)).where(eq(schema.hypotheses.runId, id))
  const instruments = run.instrumentIds.length
    ? await db.select({
        id: schema.instruments.id,
        symbol: schema.instruments.symbol,
      }).from(schema.instruments).where(inArray(schema.instruments.id, run.instrumentIds))
    : []
  return {
    ...run,
    hypotheses,
    instruments,
  }
}

/** Runs interrupted by a restart cannot resume safely; mark them failed so the user can restart explicitly. */
export async function failInterruptedRuns() {
  await db.update(schema.analysisRuns).set({
    status: 'failed',
    error: 'Прервано перезапуском приложения',
    finishedAt: new Date(),
  }).where(inArray(schema.analysisRuns.status, ['queued', 'running']))
}

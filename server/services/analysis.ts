import { createHash } from 'node:crypto'
import { db, schema } from '@nuxthub/db'
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { analystOutputSchema, criticOutputSchema, researchOutputSchema, type AnalystOutput, type StartRunInput } from '../../shared/schemas/investment'
import { DEFAULT_MIN_REWARD_RISK, type EntryScenario, type ExitScenario, type HypothesisStatus, type RunLogEntry, type SourceRef, type StrategyId, type StrategyRules } from '../../shared/types/investment'
import { redactForCritic, type CriticClaims, type EvidencePacket, type TrackStats } from '../ai/contracts'
import { aggregateStats } from '../domain/evaluations/outcome'
import { balanceByOutcome, dedupeEvents, retrospectiveRef } from '../domain/memory/selection'
import { addTradingDays, startOfUtcDay, calendarVersion } from '../domain/market/calendar'
import { researchSessionClock } from '../domain/market/physical-session-clock'
import { scenarioDeadline } from '../domain/market/scenario-deadline'
import { computeMetrics } from '../domain/market/indicators'
import { gateStatus } from '../domain/hypotheses/state'
import { validateHypothesis, validateCriticOutput } from '../domain/hypotheses/validation'
import { STRATEGY_INFO, evaluateSignal } from '../domain/strategies/rules'
import { benchmarkInstrument, getInstrument, loadResearchBars, researchBarSelection, freezeResearchSelection, syncResearchBars, syncFundamentals } from './market'
import { searchMemory, upsertDocument } from './memory'
import { trackRecord } from './evaluations'
import { getCostModel } from './settings'
import { pinStrategy, pinnedStrategy } from '../domain/strategies/pinned'
import { withSourceLease } from './source-lock'
import { loadEvidenceContext } from './evidence-packet'

const MAX_STALE_DAYS = 5
const ANALYST_VERSION = 'decision-v2'
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
  const providers = await selectedAgentProviders()
  const active = await db.select().from(schema.strategyVersions).where(and(inArray(schema.strategyVersions.strategyId, input.strategies), eq(schema.strategyVersions.status, 'active')))
  if (active.length !== input.strategies.length || new Set(active.map(v => v.strategyId)).size !== active.length) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Для каждой стратегии нужна ровно одна активная версия',
    })
  }
  const pins = Object.fromEntries(active.map(version => [version.strategyId, pinStrategy(version)]))
  for (const version of active) {
    versions[version.strategyId] = version.version
  }
  // Explicit opt-in creates a new input-set version, never rewrites strategy versions.
  let researchSelection = researchBarSelection(input.researchBarsProvider)
  if (researchSelection.provider === 'moex_iss') {
    const benchmark = await benchmarkInstrument()
    for (const id of [...new Set([...input.instrumentIds, ...(benchmark ? [benchmark.id] : [])])]) {
      await syncResearchBars(id, researchSelection)
    }
    researchSelection = {
      ...researchSelection,
      revisionCutoff: new Date().toISOString(),
    }
  }
  researchSelection = await freezeResearchSelection(researchSelection)
  const executionCosts = await getCostModel()
  const [run] = await db.insert(schema.analysisRuns).values({
    userId,
    kind: input.kind,
    strategies: input.strategies,
    instrumentIds: input.instrumentIds,
    asOf,
    status: 'queued',
    provider: providers.analyst.id,
    criticProvider: providers.critic.id,
    rulesVersions: versions,
    pinnedStrategies: pins,
    executionCosts,
    researchSelection,
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
    blockedByDataQuality: [] as {
      symbol: string
      strategy: string
      reasons: string[]
    }[],
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
    if (isLive && run.researchSelection?.provider !== 'moex_iss') {
      await logger.log('info', 'Обновление котировок и событий перед анализом')
      for (const id of [...run.instrumentIds, ...(benchmark ? [benchmark.id] : [])]) {
        await syncResearchBars(id, run.researchSelection ?? undefined)
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
          if (result.kind === 'blocked') {
            summary.blockedByDataQuality.push(result.entry)
          } else if (result.kind === 'screened') {
            summary.screenedOut.push(result.entry)
          } else if ('id' in result.entry && result.entry.id) {
            summary.hypotheses.push(result.entry as {
              id: string
              symbol: string
              strategy: string
              status: string
            })
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
    await logger.log('info', `Готово: гипотез ${summary.hypotheses.length}, отсеяно ${summary.screenedOut.length}, блокировано данными ${summary.blockedByDataQuality.length}, ошибок ${summary.failures.length}`)
    await db.update(schema.analysisRuns).set({
      status: summary.blockedByDataQuality.length === tasks.length && tasks.length > 0 ? 'blocked' : summary.blockedByDataQuality.length ? 'completed_with_blocks' : summary.failures.length === tasks.length && tasks.length > 0 ? 'failed' : 'completed',
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

export async function buildEvidencePacket(run: Pick<Run, 'id' | 'kind' | 'asOf'> & Partial<Pick<Run, 'pinnedStrategies' | 'executionCosts' | 'researchSelection'>>, instrumentId: string, strategy: StrategyId, benchmarkId: string | null) {
  const instrument = await getInstrument(instrumentId)
  const storedRun = run.pinnedStrategies ? run : (await db.select().from(schema.analysisRuns).where(eq(schema.analysisRuns.id, run.id)))[0]
  const version = pinnedStrategy(storedRun?.pinnedStrategies, strategy)
  const provider = instrument.provider === 'mock' ? 'mock' as const : 'finam' as const
  const calendar = {
    provider,
    board: instrument.board,
    asOf: run.asOf,
  }
  // Legacy runs use their original raw provider only; current MOEX settings never reinterpret them.
  const selection = storedRun?.researchSelection ?? {
    provider,
    policyId: provider === 'mock' ? 'mock_daily' as const : 'legacy_daily' as const,
    inputSetVersion: `${provider}-legacy-input-v1`,
    revisionCutoff: run.asOf.toISOString(),
  }
  const requiredBars = Math.max(210, version.rules.slowSma, version.rules.trendSma, version.rules.momentumLookback + 1, version.rules.breakoutLookback + 1, version.rules.regimeSma ?? 0)
  const research = await loadResearchBars({
    instrumentId,
    asOf: run.asOf,
    purpose: 'signal',
    limit: selection.policyId === 'physical_session_v1' ? requiredBars : 400,
    selection,
  })
  const benchmarkResearch = benchmarkId
    ? await loadResearchBars({
        instrumentId: benchmarkId,
        asOf: run.asOf,
        purpose: 'signal',
        limit: selection.policyId === 'physical_session_v1' ? requiredBars : 300,
        selection,
      })
    : null
  const quality = research.quality
  const candles = research.bars
  const benchmarkCandles = benchmarkResearch?.bars ?? []
  const physical = selection.policyId === 'physical_session_v1'
  const age = physical ? researchSessionClock(candles, research.provenance, run.asOf).stale(candles.at(-1)?.earliestUseAt) : null
  if (physical) {
    research.provenance.confirmedSessionAge = age?.status === 'known' ? age.sessions : null
  }
  const dataQuality = {
    status: quality.status === 'data_quality_blocked' || !benchmarkResearch || benchmarkResearch.quality.status === 'data_quality_blocked' ? 'data_quality_blocked' : physical ? 'research_usable_with_limits' : 'verified',
    issues: [...quality.issues, ...(benchmarkResearch?.quality.issues.map(issue => `benchmark:${issue}`) ?? ['benchmark_missing'])].slice(0, 30),
    calendarVersion: physical ? quality.calendarVersion : calendarVersion(calendar),
    normalizationVersion: quality.normalizationVersion,
  }
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
  const refs = candidates.map(m => ({
    document: m,
    ref: retrospectiveRef(m.refId),
  }))
  const legacyIds = refs.flatMap(m => m.ref && !m.ref.revisionId ? [m.ref.hypothesisId] : [])
  const revisionIds = refs.flatMap(m => m.ref?.revisionId ? [m.ref.revisionId] : [])
  const outcomeRows = legacyIds.length
    ? await db.select({
        hypothesisId: schema.hypothesisEvaluations.hypothesisId,
        outcome: schema.hypothesisEvaluations.outcome,
      }).from(schema.hypothesisEvaluations).where(inArray(schema.hypothesisEvaluations.hypothesisId, legacyIds))
    : []
  const revisionRows = revisionIds.length
    ? await db.select().from(schema.hypothesisEvaluationRevisions).where(and(inArray(schema.hypothesisEvaluationRevisions.id, revisionIds), lte(schema.hypothesisEvaluationRevisions.computedAt, run.asOf)))
    : []
  const memory = balanceByOutcome(refs.map(({ document, ref }) => {
    const revision = ref?.revisionId ? revisionRows.find(row => row.id === ref.revisionId && row.hypothesisId === ref.hypothesisId) : null
    const result = revision?.result as { scenarioEvaluation?: { outcome?: string | null } } | undefined
    return {
      ...document,
      outcome: ref?.revisionId ? result?.scenarioEvaluation?.outcome ?? null : outcomeRows.find(row => row.hypothesisId === ref?.hypothesisId)?.outcome ?? null,
    }
  }), 5)
  const costs = storedRun?.executionCosts
  if (!costs) {
    throw new Error('Издержки не зафиксированы в legacy-run; нельзя подставлять текущие значения')
  }
  const record = await trackRecord(strategy, version.id, version.rules, run.asOf, costs, selection)
  // Fresh signal suitability is separate from historical representativeness. A limited
  // backtest never becomes verified buying evidence and never blocks a no_trade explanation.
  const usableTrades = record.dataQuality.status === 'data_quality_blocked' ? [] : record.trades
  const sameSetup = usableTrades.filter(t => t.setupType === signal.setupType)
  const sameSymbol = usableTrades.filter(t => t.symbol === instrument.symbol)
  const lastTs = candles.at(-1)?.ts ?? run.asOf.toISOString()
  const context = await loadEvidenceContext(instrumentId, run.asOf)
  const sources: SourceRef[] = [
    ...context.sources,
    {
      id: 'candles',
      kind: 'candles',
      title: `${physical ? 'MOEX: реконструкция физических сессий; историческая доступность неизвестна' : 'Дневные свечи'} ${instrument.symbol} (${candles.length} шт.)`,
      observedAt: research.provenance.observedAt ?? undefined,
      contentHash: research.provenance.inputHash,
      url: null,
      asOf: lastTs,
    },
    {
      id: 'metrics',
      kind: 'metrics',
      title: `Индикаторы и сигнал стратегии (рассчитаны кодом)${physical ? '; реконструкция, не наблюдавшаяся IIS в прошлом' : ''}`,
      observedAt: research.provenance.observedAt ?? undefined,
      url: null,
      asOf: lastTs,
    },
    {
      id: 'track',
      kind: 'backtest',
      observedAt: research.provenance.observedAt ?? undefined,
      title: `${physical ? 'Реконструкция с ограничениями; историческая доступность неизвестна. ' : ''}Point-in-time бэктест ${STRATEGY_INFO[strategy].name} v${version.version} (${record.trades.length} сделок)`,
      url: null,
      asOf: lastTs,
    },
    ...events.map(({ event: e }) => ({
      id: `ev:${e.id.slice(0, 8)}`,
      kind: 'event' as const,
      title: e.title,
      url: e.url,
      asOf: e.retrievedAt.toISOString(),
      publishedAt: e.publishedAt.toISOString(),
      availableAt: e.retrievedAt.toISOString(),
      observedAt: e.retrievedAt.toISOString(),
      contentHash: createHash('sha256').update(JSON.stringify({
        externalId: e.externalId,
        title: e.title,
        body: e.body,
      })).digest('hex'),
    })),
    ...reports.map(r => ({
      id: `rep:${r.id.slice(0, 8)}`,
      kind: 'report' as const,
      title: `${r.reportType} ${r.period}`,
      url: r.url,
      asOf: r.availableAt.toISOString(),
      publishedAt: r.publishedAt.toISOString(),
      availableAt: r.availableAt.toISOString(),
      observedAt: r.availableAt.toISOString(),
      verification: 'aggregated_unverified' as const,
      contentHash: createHash('sha256').update(JSON.stringify({
        externalId: r.externalId,
        metrics: r.metrics,
      })).digest('hex'),
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
  const auditPayload = {
    ...record.audit,
    dataQuality,
    pinnedStrategy: version,
  }
  const [audit] = await db.insert(schema.sourceSnapshots).values({
    runId: run.id,
    instrumentId,
    kind: 'track_record_audit',
    payload: auditPayload,
    sha256: sha256(auditPayload),
    asOf: run.asOf,
  }).returning({ id: schema.sourceSnapshots.id })
  let nextEntry = 'не установлено: календарь или контракт свечи не подтверждён'
  let marketScenario: import('../../shared/types/investment').MarketScenario | undefined
  if (dataQuality.status !== 'data_quality_blocked' && signal.entry !== null && signal.stopLoss !== null && signal.takeProfit !== null) {
    try {
      if (physical) {
        nextEntry = 'условно: следующая подтверждённая физическая сессия; будущий допуск неизвестен'
      } else {
        nextEntry = addTradingDays(new Date(lastTs), 1, calendar).toISOString().slice(0, 10)
        scenarioDeadline(run.asOf, {
          type: 'market_next_open',
          price: signal.entry,
          validDays: version.rules.entryValidDays,
          note: '',
        }, {
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          timeExitDays: version.rules.horizonDays,
          note: '',
        }, calendar)
      }
      marketScenario = {
        horizonUnit: physical ? 'confirmed_sessions' : 'logical_trading_days',
        deadlineConditional: physical,
        inputSetVersion: selection.inputSetVersion,
        researchSelection: selection,
        entry: {
          type: 'market_next_open',
          price: signal.entry,
          validDays: version.rules.entryValidDays,
          note: 'Условное открытие следующего подтверждённого торгового дня',
        },
        exit: {
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          timeExitDays: version.rules.horizonDays,
          note: 'Уровни рассчитаны кодом из закреплённых правил',
        },
        horizonTradingDays: version.rules.horizonDays,
        strategyVersionId: version.id,
        version: version.version,
        rulesHash: version.rulesHash,
        calendarVersion: dataQuality.calendarVersion,
        normalizationVersion: dataQuality.normalizationVersion,
        costs,
      }
    } catch (error) {
      dataQuality.status = 'data_quality_blocked'
      dataQuality.issues.push((error as Error).message)
    }
  }
  const packet: EvidencePacket = {
    ...context,
    marketData: research.provenance,
    benchmarkData: benchmarkResearch?.provenance,
    backtestQuality: record.dataQuality,
    marketScenario,
    dataQuality,
    calendarVersion: dataQuality.calendarVersion,
    normalizationVersion: dataQuality.normalizationVersion,
    pinnedStrategy: version,
    permittedSourceIds: sources.map(source => source.id),
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
      note: `Бэктест закреплённой версии правил по текущей вселенной; состав/делистинги исторически не подтверждены; выборки all/sameSetup/sameSymbol пересекаются. На дату до ${run.asOf.toISOString().slice(0, 10)}: только сделки, закрытые до этой даты; издержки вычтены. Прошлое не гарантирует будущего.`,
      audit: {
        id: audit!.id,
        hash: sha256(auditPayload),
        inputSeriesHash: record.audit.inputSeriesHash,
      },
      validity: record.dataQuality.status,
      universe: new Set(usableTrades.map(t => t.symbol)).size,
      all: trackStats(usableTrades),
      sameSetup: trackStats(sameSetup),
      sameSymbol: trackStats(sameSymbol),
    },
    execution: {
      entry: `Последняя подтверждённая сессия — ${lastTs.slice(0, 10)}; ${physical ? 'следующая физическая сессия' : 'следующее логическое торговое открытие'}: ${nextEntry}. Условный сценарий не является рекомендацией. При гэпе уровни прибыль/риск меняются.`,
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
  if (packet.dataQuality?.status === 'data_quality_blocked' || !packet.marketScenario || (run.kind === 'research' && !signal.setup)) {
    await logger.log('info', `${label}: ${packet.dataQuality?.status ?? 'screened'} — ${[...signal.failures, ...(packet.dataQuality?.issues ?? [])].join('; ')}`)
    return {
      kind: packet.dataQuality?.status === 'data_quality_blocked' || !packet.marketScenario ? 'blocked' as const : 'screened' as const,
      entry: {
        symbol: instrument.symbol,
        strategy,
        reasons: [...(packet.dataQuality?.status === 'data_quality_blocked' ? ['data_quality_blocked: контракт дневных свечей или календаря не подтверждён; новый вывод не сформирован'] : []), ...signal.failures, ...(packet.dataQuality?.issues ?? [])],
      },
    }
  }
  const analyst = providerById(run.provider)
  await logger.log('info', `${label}: market_researcher (${analyst.id})`)
  const research = await analyst.run({
    role: 'market_researcher',
    task: `Исследуй ${instrument.name} (${instrument.symbol}) для стратегии ${STRATEGY_INFO[strategy].name}, горизонт ${version.rules.horizonDays} ${packet.marketScenario?.horizonUnit === 'confirmed_sessions' ? 'подтверждённых физических сессий' : 'торговых дней'}, на момент ${packet.asOf}.`,
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
  const entry: EntryScenario = packet.marketScenario.entry
  const exit: ExitScenario = packet.marketScenario.exit
  const validation = validateHypothesis({
    draft: draft.output,
    entry,
    exit,
    sources: packet.sources,
    strategy: packet.strategy.id,
    calendar: {
      provider: instrument.provider === 'mock' ? 'mock' : 'finam',
      board: instrument.board,
      asOf: run.asOf,
    },
    confirmedSessionAge: packet.marketData?.barPolicy === 'physical_session_v1' ? packet.marketData.confirmedSessionAge ?? Infinity : undefined,
    backtestVerified: packet.backtestQuality?.status === 'verified',
    coverage: packet.evidenceCoverage,
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
  const status = await runCritic(hypothesis.id, logger, run.criticProvider)
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
      semanticVersion: 'decision_v2',
      recommendation: draft.recommendation,
      decisionThesis: draft.decisionThesis,
      decisionBasis: draft.decisionBasis,
      decisionConfidence: draft.decisionConfidence,
      priceForecast: draft.priceForecast,
      coverageGaps: draft.coverageGaps,
      marketScenario: input.packet.marketScenario,
      verdictTarget: 'decision',
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
      // A monitoring date, not an invented exchange execution deadline; the scenario says conditional.
      checkAt: input.packet.marketScenario?.deadlineConditional
        ? new Date(run.asOf.getTime() + 86_400_000)
        : scenarioDeadline(run.asOf, input.entry, input.exit, {
            provider: input.packet.dataQuality?.calendarVersion === 'mock-weekday-v1' ? 'mock' : 'finam',
            asOf: run.asOf,
          }),
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
export function runCritic(hypothesisId: string, logger?: RunLogger, providerId?: string): Promise<HypothesisStatus> {
  return withSourceLease(`hypothesis-critic:${hypothesisId}`, () => runCriticLocked(hypothesisId, logger, providerId))
}

async function runCriticLocked(hypothesisId: string, logger?: RunLogger, providerId?: string): Promise<HypothesisStatus> {
  const [h] = await db.select().from(schema.hypotheses).where(eq(schema.hypotheses.id, hypothesisId))
  if (!h) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Hypothesis not found',
    })
  }
  if (!['awaiting_critic', 'needs_review', 'watching'].includes(h.status)) {
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
  if (h.semanticVersion === 'legacy') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Legacy-гипотеза сохраняется без AI-переинтерпретации; запустите новое исследование',
    })
  }
  const claims: CriticClaims = {
    recommendation: h.recommendation ?? h.direction as 'long' | 'no_trade',
    decisionThesis: h.decisionThesis ?? h.thesis,
    decisionBasis: h.decisionBasis ?? [],
    priceForecast: h.priceForecast,
    coverageGaps: h.coverageGaps ?? [],
    direction: h.direction as CriticClaims['direction'],
    thesis: h.thesis,
    supportingEvidence: h.supportingEvidence,
    counterEvidence: h.counterEvidence,
    assumptions: h.assumptions,
    invalidationConditions: h.invalidationConditions,
    entry: h.entryScenario,
    exit: h.exitScenario,
  }
  const critic = providerId ? providerById(providerId) : await agentProvider('critic')
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(schema.hypotheses).where(eq(schema.hypotheses.id, hypothesisId)).for('update')
    if (!current || !['awaiting_critic', 'needs_review', 'watching'].includes(current.status)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Статус гипотезы изменился до повторной проверки',
      })
    }
    await tx.update(schema.hypotheses).set({
      status: 'awaiting_critic',
      criticVerdict: null,
      forecastVerdict: null,
      updatedAt: new Date(),
    }).where(eq(schema.hypotheses.id, hypothesisId))
    await tx.insert(schema.hypothesisEvents).values({
      hypothesisId,
      type: 'critic_started',
      fromStatus: current.status,
      toStatus: 'awaiting_critic',
      actor: 'system',
    })
  })
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
    const checked = validateCriticOutput(result.output, evidence.sources, new Date(evidence.asOf), h.priceForecast)
    const status = gateStatus({
      criticVerdict: checked.ok ? result.output.decisionVerdict : 'insufficient_evidence',
      criticSucceeded: true,
      validationOk: h.validation.ok && checked.ok,
    })
    await db.transaction(async (tx) => {
      await tx.insert(schema.hypothesisReviews).values({
        hypothesisId,
        role: 'critic',
        provider: result.provider,
        verdictTarget: 'decision',
        forecastVerdict: result.output.forecastVerdict,
        validationIssues: checked.issues,
        verdict: checked.ok ? result.output.decisionVerdict : 'insufficient_evidence',
        summary: result.output.summary,
        findings: checked.ok ? result.output.findings : [],
        missingChecks: result.output.missingChecks,
        raw: result.raw,
        durationMs: result.durationMs,
      })
      await tx.update(schema.hypotheses).set({
        status,
        verdictTarget: 'decision',
        forecastVerdict: checked.ok ? result.output.forecastVerdict : null,
        criticVerdict: checked.ok ? result.output.decisionVerdict : 'insufficient_evidence',
        criticFindings: checked.ok ? result.output.findings : [],
        updatedAt: new Date(),
      }).where(eq(schema.hypotheses.id, hypothesisId))
      await tx.insert(schema.hypothesisEvents).values({
        hypothesisId,
        type: 'critic_completed',
        fromStatus: h.status,
        toStatus: status,
        actor: 'agent',
        payload: {
          verdictTarget: 'decision',
          forecastVerdict: result.output.forecastVerdict,
          validationIssues: checked.issues,
          verdict: checked.ok ? result.output.decisionVerdict : 'insufficient_evidence',
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
        `Критик по решению: ${checked.ok ? result.output.decisionVerdict : 'insufficient_evidence'}. ${checked.ok ? result.output.summary : checked.issues.join('; ')}`,
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
      toStatus: 'awaiting_critic',
      actor: 'system',
      comment: (error as Error).message.slice(0, 2000),
      payload: {
        provider: critic.id,
        durationMs: Date.now() - started,
      },
    })
    await logger?.log('warn', `Критик не отработал для ${hypothesisId.slice(0, 8)}: ${(error as Error).message}. Гипотеза остаётся в awaiting_critic.`)
    return 'awaiting_critic'
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

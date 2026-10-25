import { ensureSources, recordSourceResult } from './source-status'
import { db, schema } from '@nuxthub/db'
import { and, asc, desc, eq, gt, gte, lte } from 'drizzle-orm'
import type { Candle } from '../../shared/types/investment'
import { MoexIssResearchProvider } from '../adapters/market/moex-iss'
import { PHYSICAL_POLICY_VERSION, marketHash } from '../domain/market/source-policy'
import { inspectBarQuality } from '../domain/market/bar-quality'
import { upsertDocument } from './memory'

const HISTORY_DAYS = 3 * 365

export async function syncInstruments() {
  const provider = marketProvider()
  const stored = await db.select({ provider: schema.instruments.provider }).from(schema.instruments)
  if (stored.some(i => i.provider !== provider.id)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Market provider differs from stored data. Use a separate database to avoid mixing mock and real history.',
    })
  }
  const list = await provider.listInstruments()
  for (const item of list) {
    await db.insert(schema.instruments).values({
      ...item,
      provider: provider.id,
    }).onConflictDoUpdate({
      target: schema.instruments.symbol,
      set: {
        name: item.name,
        board: item.board,
        currency: item.currency,
        isin: item.isin,
        lotSize: item.lotSize,
        sector: item.sector,
        kind: item.kind,
        provider: provider.id,
        updatedAt: new Date(),
      },
    })
  }
  return list.length
}

export async function getInstrument(id: string) {
  const [row] = await db.select().from(schema.instruments).where(eq(schema.instruments.id, id))
  if (!row) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Instrument not found',
    })
  }
  return row
}

export async function benchmarkInstrument() {
  const [row] = await db.select().from(schema.instruments).where(eq(schema.instruments.symbol, marketProvider().benchmarkSymbol))
  return row ?? null
}

/** Incremental daily-candle sync from the last stored bar. */
export async function syncCandles(instrumentId: string) {
  const instrument = await getInstrument(instrumentId)
  const [last] = await db.select({ ts: schema.candles.ts }).from(schema.candles).where(and(eq(schema.candles.instrumentId, instrumentId), eq(schema.candles.timeframe, 'D'))).orderBy(desc(schema.candles.ts)).limit(1)
  const from = last ? new Date(last.ts.getTime() - 3 * 86_400_000) : new Date(Date.now() - HISTORY_DAYS * 86_400_000)
  const candles = await marketProvider().getCandles(instrument.symbol, from, new Date(), async (response) => {
    await db.insert(schema.rawMarketBars).values({
      instrumentId,
      source: instrument.provider,
      board: instrument.board,
      endpoint: response.endpoint,
      interval: 'D',
      payload: response.payload,
      responseHash: marketHash(response.payload),
      observedAt: new Date(response.observedAt),
    })
  })
  for (let i = 0; i < candles.length; i += 500) {
    const chunk = candles.slice(i, i + 500).map(c => ({
      instrumentId,
      timeframe: 'D',
      ts: new Date(c.ts),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      metadata: Object.fromEntries(Object.entries(c).filter(([key]) => !['ts', 'open', 'high', 'low', 'close', 'volume'].includes(key))),
    }))
    // Keep the first stored bar intact. Corrections require a separately audited normalization/version.
    await db.insert(schema.candles).values(chunk).onConflictDoNothing()
  }
  return candles.length
}

/** Events and reports, mirrored into point-in-time memory documents. */
export async function syncFundamentals(instrumentId: string) {
  const instrument = await getInstrument(instrumentId)
  const provider = marketProvider()
  const from = new Date(Date.now() - HISTORY_DAYS * 86_400_000)
  const to = new Date()
  const results = await Promise.allSettled([
    provider.getEvents(instrument.symbol, from, to),
    provider.getReports(instrument.symbol, from, to),
  ])
  const events = results[0].status === 'fulfilled' ? results[0].value : []
  const reports = results[1].status === 'fulfilled' ? results[1].value : []
  const errors = results.flatMap((result, index) => result.status === 'rejected'
    ? [`${instrument.ticker} · ${index === 0 ? 'новости' : 'отчётность'}: ${result.reason instanceof Error ? result.reason.message : 'Источник недоступен'}`]
    : [])
  if (provider.id === 'finam' && instrument.kind === 'equity') {
    await ensureSources()
    for (const [index, sourceId] of ['finam_news_rss', 'smartlab_ifrs'].entries()) {
      const result = results[index]!
      await recordSourceResult(sourceId, result.status === 'rejected' ? 'legacy_source_unavailable' : null, result.status === 'fulfilled' && result.value.length > 0)
    }
  }
  const existing = new Set((await db.select({ externalId: schema.marketEvents.externalId }).from(schema.marketEvents).where(eq(schema.marketEvents.instrumentId, instrumentId))).map(r => r.externalId))
  for (const event of events.filter(e => !existing.has(e.externalId))) {
    const [row] = await db.insert(schema.marketEvents).values({
      externalId: event.externalId,
      instrumentId,
      kind: event.kind,
      title: event.title,
      body: event.body,
      url: event.url,
      source: event.source,
      sentiment: event.sentiment,
      publishedAt: new Date(event.publishedAt),
    }).onConflictDoNothing().returning({ id: schema.marketEvents.id })
    if (row) {
      await upsertDocument({
        kind: 'event',
        refId: row.id,
        instrumentId,
        title: `${instrument.ticker}: ${event.title}`,
        content: event.body,
        availableAt: new Date(),
      })
    }
  }
  for (const report of reports) {
    const [row] = await db.insert(schema.issuerReports).values({
      externalId: report.externalId,
      instrumentId,
      period: report.period,
      reportType: report.reportType,
      metrics: report.metrics,
      source: report.source,
      url: report.url,
      documentUrl: report.documentUrl ?? null,
      availableAt: new Date(report.availableAt ?? report.publishedAt),
      publishedAt: new Date(report.publishedAt),
    }).onConflictDoNothing().returning({ id: schema.issuerReports.id })
    if (row) {
      await upsertDocument({
        kind: 'report',
        refId: row.id,
        instrumentId,
        title: `${instrument.ticker}: ${report.reportType} ${report.period}`,
        content: JSON.stringify({
          source: report.source,
          url: report.url,
          documentUrl: report.documentUrl,
          period: report.period,
          metrics: report.metrics,
        }),
        availableAt: new Date(report.availableAt ?? report.publishedAt),
      })
    }
  }
  return {
    events: events.length,
    reports: reports.length,
    errors,
  }
}

export async function syncAll() {
  const instruments = await syncInstruments()
  const rows = await db.select({ id: schema.instruments.id }).from(schema.instruments).where(eq(schema.instruments.active, true))
  let candles = 0
  let events = 0
  let reports = 0
  const sourceErrors: string[] = []
  for (const row of rows) {
    candles += await syncCandles(row.id)
    const fundamentals = await syncFundamentals(row.id)
    events += fundamentals.events
    reports += fundamentals.reports
    sourceErrors.push(...fundamentals.errors)
  }
  return {
    instruments,
    candles,
    events,
    reports,
    sourceErrors,
  }
}

export async function loadCandles(instrumentId: string, options: {
  to?: Date
  from?: Date
  after?: Date
  limit?: number
} = {}): Promise<Candle[]> {
  const conditions = [eq(schema.candles.instrumentId, instrumentId), eq(schema.candles.timeframe, 'D')]
  if (options.to) {
    conditions.push(lte(schema.candles.ts, options.to))
  }
  if (options.from) {
    conditions.push(gte(schema.candles.ts, options.from))
  }
  if (options.after) {
    conditions.push(gt(schema.candles.ts, options.after))
  }
  const ordered = options.limit && !options.after
    ? (await db.select().from(schema.candles).where(and(...conditions)).orderBy(desc(schema.candles.ts)).limit(options.limit)).reverse()
    : await db.select().from(schema.candles).where(and(...conditions)).orderBy(asc(schema.candles.ts)).limit(options.limit ?? 100_000)
  return ordered.filter(c => !options.to || ((!c.metadata?.completedAt || new Date(c.metadata.completedAt) <= options.to) && (!c.metadata?.availableAt || new Date(c.metadata.availableAt) <= options.to))).map(c => ({
    ...c.metadata,
    ts: c.ts.toISOString(),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }))
}

export async function lastClose(instrumentId: string) {
  const research = await loadResearchBars({
    instrumentId,
    asOf: new Date(),
    purpose: 'paper',
    limit: 2,
  })
  const bar = research.quality.status === 'verified' ? research.bars.at(-1) : null
  return bar
    ? {
        close: bar.close,
        ts: new Date(bar.ts),
      }
    : null
}

/** Explicit raw display helper; never a risk or order input. */
export async function rawLastClose(instrumentId: string) {
  const [row] = await db.select({
    close: schema.candles.close,
    ts: schema.candles.ts,
  }).from(schema.candles).where(and(eq(schema.candles.instrumentId, instrumentId), eq(schema.candles.timeframe, 'D'))).orderBy(desc(schema.candles.ts)).limit(1)
  return row ?? null
}

/** Explicit research input selection; no change to broker/account provider. */
export function researchBarSelection(providerOverride?: 'moex_iss'): import('../../shared/types/market-data').ResearchBarSelection {
  const config = useRuntimeConfig()
  const provider = providerOverride ?? (config.researchBarsProvider || config.marketProvider)
  if (!['finam', 'mock', 'moex_iss'].includes(provider)) {
    throw new Error('Unknown research bars provider')
  }
  if (provider === 'moex_iss' && !providerOverride && config.researchBarPolicy !== 'physical_session_v1') {
    throw new Error('MOEX research requires explicit physical_session_v1 policy')
  }
  return {
    provider: provider as 'finam' | 'mock' | 'moex_iss',
    policyId: provider === 'moex_iss' ? 'physical_session_v1' : provider === 'mock' ? 'mock_daily' : 'legacy_daily',
    revisionCutoff: new Date().toISOString(),
    inputSetVersion: provider === 'moex_iss' ? PHYSICAL_POLICY_VERSION : `${provider}-legacy-input-v1`,
  }
}

/** Pin exact committed revisions, including explicit absence, before queuing a run. */
export async function freezeResearchSelection(selection: import('../../shared/types/market-data').ResearchBarSelection) {
  if (selection.provider !== 'moex_iss') {
    return selection
  }
  const instruments = await db.select({ id: schema.instruments.id }).from(schema.instruments)
  const audits = await db.select().from(schema.barQualityAudits).where(and(eq(schema.barQualityAudits.source, 'moex_iss'), eq(schema.barQualityAudits.policyId, selection.policyId), lte(schema.barQualityAudits.observedAt, new Date(selection.revisionCutoff)))).orderBy(desc(schema.barQualityAudits.observedAt))
  const auditIds: Record<string, string | null> = Object.fromEntries(instruments.map(i => [i.id, null]))
  for (const audit of audits) {
    if (auditIds[audit.instrumentId] === null) {
      auditIds[audit.instrumentId] = audit.id
    }
  }
  return {
    ...selection,
    auditIds,
  }
}

/** Manual synchronization writes new evidence only, never mutates old candles or revisions. */
export async function syncResearchBars(instrumentId: string, selection = researchBarSelection()) {
  if (selection.provider !== 'moex_iss') {
    return syncCandles(instrumentId)
  }
  const instrument = await getInstrument(instrumentId)
  if (instrument.provider === 'mock') {
    throw new Error('Cannot import real bars into a mock instrument')
  }
  const [recent] = await db.select().from(schema.barQualityAudits).where(and(eq(schema.barQualityAudits.instrumentId, instrumentId), eq(schema.barQualityAudits.source, 'moex_iss'), eq(schema.barQualityAudits.policyVersion, PHYSICAL_POLICY_VERSION))).orderBy(desc(schema.barQualityAudits.observedAt)).limit(1)
  if (recent && recent.status !== 'missing' && Date.now() - recent.observedAt.getTime() < 4 * 3_600_000) {
    return recent.payload.assessments.length
  }
  const to = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10)
  const rawIds: string[] = []
  const fetched = await new MoexIssResearchProvider().getSeries(instrument, from, to, async (response) => {
    const [raw] = await db.insert(schema.rawMarketBars).values({
      instrumentId,
      source: 'moex_iss',
      endpoint: response.endpoint,
      board: instrument.kind === 'index' ? 'SNDX' : 'TQBR',
      interval: String(response.interval),
      payload: {
        columns: response.columns,
        data: response.data,
      },
      responseHash: response.hash,
      observedAt: new Date(response.observedAt),
    }).returning({ id: schema.rawMarketBars.id })
    rawIds.push(raw!.id)
  }).catch(async (error: unknown) => {
    await db.insert(schema.barQualityAudits).values({
      instrumentId,
      source: 'moex_iss',
      policyId: selection.policyId,
      policyVersion: PHYSICAL_POLICY_VERSION,
      sourceRevision: marketHash(rawIds),
      board: instrument.kind === 'index' ? 'SNDX' : 'TQBR',
      market: instrument.kind === 'index' ? 'index' : 'shares',
      fromDate: from,
      toDate: to,
      observedAt: new Date(),
      status: 'missing',
      payload: {
        assessments: [],
        rawIds,
        issues: [error instanceof Error ? error.message.slice(0, 500) : 'source_request_failed'],
      },
    })
    throw error
  })
  await db.transaction(async (tx) => {
    const [audit] = await tx.insert(schema.barQualityAudits).values({
      instrumentId,
      source: 'moex_iss',
      policyId: selection.policyId,
      policyVersion: PHYSICAL_POLICY_VERSION,
      sourceRevision: fetched.sourceRevision,
      board: fetched.board,
      market: fetched.market,
      fromDate: from,
      toDate: to,
      observedAt: new Date(fetched.observedAt),
      status: fetched.assessments.some(a => a.status === 'quarantined') ? 'quarantined' : 'research_usable_with_limits',
      payload: {
        assessments: fetched.assessments,
        rawIds,
        issues: ['historical_availability_unknown', 'source_adjustment_policy_unknown'],
      },
    }).returning({ id: schema.barQualityAudits.id })
    const rows = fetched.assessments.filter(a => a.candle).map(a => ({
      auditId: audit!.id,
      instrumentId,
      source: 'moex_iss',
      policyId: selection.policyId,
      sourceRevision: fetched.sourceRevision,
      sessionDate: a.date,
      status: a.status,
      candle: a.candle!,
    }))
    for (let i = 0; i < rows.length; i += 300) {
      await tx.insert(schema.normalizedMarketBars).values(rows.slice(i, i + 300))
    }
  })
  console.info('[FIX:market-data] immutable MOEX revision', instrument.ticker, fetched.sourceRevision, fetched.assessments.length)
  return fetched.assessments.length
}

/** The only calculation path. Raw display stays separate. A source change is never implicit. */
export async function loadResearchBars(options: {
  instrumentId: string
  asOf: Date
  purpose: 'signal' | 'backtest' | 'evaluation' | 'paper'
  from?: Date
  after?: Date
  limit?: number
  selection?: import('../../shared/types/market-data').ResearchBarSelection
}): Promise<{
  bars: Candle[]
  quality: import('../../shared/types/market-data').ResearchQuality
  provenance: import('../../shared/types/market-data').ResearchProvenance
  gaps: string[]
}> {
  const instrument = await getInstrument(options.instrumentId)
  const selection = options.selection ?? researchBarSelection()
  const version = selection.provider === 'moex_iss' ? PHYSICAL_POLICY_VERSION : 'legacy_unknown'
  const provenance = {
    selection,
    source: selection.provider,
    instrument: instrument.symbol,
    board: selection.provider === 'moex_iss' && instrument.kind === 'index' ? 'SNDX' : instrument.board,
    market: instrument.kind === 'index' ? 'index' : 'shares',
    sourceRevision: '',
    calendarVersion: version,
    barPolicy: selection.policyId,
    historicalAvailability: selection.provider === 'mock' ? 'verified' as const : 'unknown' as const,
    reconstruction: selection.provider === 'moex_iss',
    adjustmentPolicy: selection.provider === 'mock' ? 'synthetic' : 'source_native_adjustment_unknown',
    observedAt: null as string | null,
    inputHash: '',
    coverage: undefined as import('../../shared/types/market-data').ResearchProvenance['coverage'],
  }
  if (selection.provider !== 'moex_iss') {
    if ((instrument.provider === 'mock') !== (selection.provider === 'mock')) {
      throw new Error('Research source/instrument mismatch; no fallback')
    }
    const raw = await loadCandles(instrument.id, {
      to: options.asOf,
      from: options.from,
      after: options.after,
      limit: options.limit,
    })
    const quality = inspectBarQuality(raw, {
      dataSource: selection.provider,
      board: instrument.board,
      asOf: options.asOf,
    })
    provenance.inputHash = marketHash(raw)
    return {
      bars: quality.completedBars,
      quality,
      provenance,
      gaps: quality.issues,
    }
  }
  if (selection.policyId !== 'physical_session_v1' || selection.inputSetVersion !== PHYSICAL_POLICY_VERSION || instrument.provider === 'mock') {
    throw new Error('Incompatible research source policy/input set')
  }
  const [audit] = await db.select().from(schema.barQualityAudits).where(and(eq(schema.barQualityAudits.instrumentId, instrument.id), eq(schema.barQualityAudits.source, 'moex_iss'), eq(schema.barQualityAudits.policyId, selection.policyId), selection.auditIds ? eq(schema.barQualityAudits.id, selection.auditIds[instrument.id] ?? '00000000-0000-0000-0000-000000000000') : undefined, lte(schema.barQualityAudits.observedAt, new Date(selection.revisionCutoff)))).orderBy(desc(schema.barQualityAudits.observedAt)).limit(1)
  const issues: string[] = []
  let selected: import('../domain/market/source-policy').PhysicalBarAssessment[] = []
  if (!audit) {
    issues.push(`${instrument.ticker}:missing_source_revision:manual_sync_required`)
  } else {
    Object.assign(provenance, {
      coverage: {
        from: audit.fromDate,
        to: audit.toDate,
        observedAt: audit.observedAt.toISOString(),
        hash: audit.sourceRevision,
      },
      sourceRevision: audit.sourceRevision,
      observedAt: audit.observedAt.toISOString(),
      board: audit.board,
      market: audit.market,
    })
    if (audit.policyVersion !== PHYSICAL_POLICY_VERSION) {
      issues.push('source_policy_version_mismatch')
    }
    const rows = await db.select().from(schema.normalizedMarketBars).where(eq(schema.normalizedMarketBars.auditId, audit.id))
    const byDate = new Map(rows.map(r => [r.sessionDate, r]))
    selected = audit.payload.assessments.filter(a => Date.parse(`${a.date}T00:00:00+03:00`) + 2 * 86_400_000 <= options.asOf.getTime() && (!options.from || a.date >= options.from.toISOString().slice(0, 10)) && (!options.after || a.date > options.after.toISOString().slice(0, 10)))
    if (options.limit) {
      selected = options.after ? selected.slice(0, options.limit) : selected.slice(-options.limit)
    }
    for (const assessment of selected) {
      const row = byDate.get(assessment.date)
      if (assessment.status === 'quarantined' || !row || marketHash(row.candle) !== marketHash(assessment.candle)) {
        issues.push(`${instrument.ticker}/${assessment.date}:${assessment.issues.join(',') || 'normalized_revision_hash_mismatch'}`)
      }
    }
    const requiredFrom = options.from?.toISOString().slice(0, 10)
    if (requiredFrom && audit.fromDate > requiredFrom) {
      issues.push(`history_range_missing:${requiredFrom}:${audit.fromDate}`)
    }
  }
  // Historical reconstructed prices may be used explicitly for research only; observedAt is
  // retained as the real fetch time, never invented as a historical publication timestamp.
  const usable = selected.filter(a => a.status === 'research_usable_with_limits' && a.candle && Date.parse(a.candle.earliestUseAt!) <= options.asOf.getTime())
  const bars = usable.map(a => a.candle!)
  if (options.purpose === 'signal' && options.limit && bars.length < options.limit) {
    issues.push(`insufficient_required_window:${instrument.ticker}:${bars.length}/${options.limit}`)
  }
  if (!bars.length) {
    issues.push(`${instrument.ticker}:missing_completed_reconciled_bars`)
  }
  if (options.purpose === 'paper') {
    issues.push('paper_requires_verified_observed_prices:historical_reconstruction_not_fill_permission')
  }
  const status = issues.length ? 'data_quality_blocked' as const : 'research_usable_with_limits' as const
  const limits = ['historical_availability_unknown:explicit_market_reconstruction', 'source_adjustment_policy_unknown:backtest_not_verified']
  provenance.inputHash = marketHash(selected)
  const quality = {
    status,
    issues: [...issues, ...limits],
    calendarVersion: version,
    normalizationVersion: PHYSICAL_POLICY_VERSION,
    contractVersion: audit?.id ?? null,
    completedBars: issues.length ? [] : bars,
  }
  return {
    bars: quality.completedBars,
    quality,
    provenance,
    gaps: quality.issues,
  }
}

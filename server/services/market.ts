import { ensureSources, recordSourceResult } from './source-status'
import { db, schema } from '@nuxthub/db'
import { and, asc, desc, eq, gt, gte, lte } from 'drizzle-orm'
import type { Candle } from '../../shared/types/investment'
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
  const candles = await marketProvider().getCandles(instrument.symbol, from, new Date())
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
  const [row] = await db.select({
    close: schema.candles.close,
    ts: schema.candles.ts,
  }).from(schema.candles).where(and(eq(schema.candles.instrumentId, instrumentId), eq(schema.candles.timeframe, 'D'))).orderBy(desc(schema.candles.ts)).limit(1)
  return row ?? null
}

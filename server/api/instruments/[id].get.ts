import { db, schema } from '@nuxthub/db'
import { and, desc, eq } from 'drizzle-orm'
import { STRATEGY_IDS } from '../../../shared/types/investment'
import { evaluateSignal } from '../../domain/strategies/rules'
import { benchmarkInstrument, getInstrument, loadCandles } from '../../services/market'
import { activeVersion } from '../../services/strategies'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const id = uuidParam(event)
  const instrument = await getInstrument(id)
  const candles = await loadCandles(id, { limit: 400 })
  const benchmark = await benchmarkInstrument()
  const benchmarkCandles = benchmark ? await loadCandles(benchmark.id, { limit: 300 }) : []
  const signals = await Promise.all(STRATEGY_IDS.map(async (strategy) => {
    const version = await activeVersion(strategy)
    return {
      strategy,
      version: version.version,
      ...evaluateSignal(strategy, version.rules, candles, benchmarkCandles),
    }
  }))
  const [events, reports] = await Promise.all([
    db.select().from(schema.marketEvents).where(eq(schema.marketEvents.instrumentId, id)).orderBy(desc(schema.marketEvents.publishedAt)).limit(30),
    db.select().from(schema.issuerReports).where(and(eq(schema.issuerReports.instrumentId, id))).orderBy(desc(schema.issuerReports.publishedAt)).limit(8),
  ])
  return {
    instrument,
    candles: candles.slice(-250),
    signals,
    events,
    reports,
  }
})

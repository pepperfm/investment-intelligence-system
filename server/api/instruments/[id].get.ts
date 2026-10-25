import { bankEvidence } from '../../services/bank-evidence'
import { compareFinancialFacts, issuerIndustry } from '../../domain/evidence/financials'
import { loadIssuerFacts } from '../../services/issuer-fundamentals'
import { db, schema } from '@nuxthub/db'
import { and, desc, eq } from 'drizzle-orm'
import { STRATEGY_IDS } from '../../../shared/types/investment'
import { evaluateSignal } from '../../domain/strategies/rules'
import { benchmarkInstrument, getInstrument, loadCandles } from '../../services/market'
import { inspectBarQuality } from '../../domain/market/bar-quality'
import { activeVersion } from '../../services/strategies'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const id = uuidParam(event)
  const instrument = await getInstrument(id)
  const candles = await loadCandles(id, { limit: 400 })
  const benchmark = await benchmarkInstrument()
  const benchmarkCandles = benchmark ? await loadCandles(benchmark.id, { limit: 300 }) : []
  const quality = inspectBarQuality(candles, {
    dataSource: instrument.provider === 'mock' ? 'mock' : 'finam',
    board: instrument.board,
    asOf: new Date(),
  })
  const benchmarkQuality = inspectBarQuality(benchmarkCandles, {
    dataSource: benchmark?.provider === 'mock' ? 'mock' : 'finam',
    board: benchmark?.board,
    asOf: new Date(),
  })
  const verified = quality.status === 'verified' && benchmarkQuality.status === 'verified'
  const signals = await Promise.all(STRATEGY_IDS.map(async (strategy) => {
    const version = await activeVersion(strategy)
    return {
      strategy,
      version: version.version,
      ...evaluateSignal(strategy, version.rules, verified ? quality.completedBars : [], verified ? benchmarkQuality.completedBars : []),
    }
  }))
  const [events, reports] = await Promise.all([
    db.select().from(schema.marketEvents).where(eq(schema.marketEvents.instrumentId, id)).orderBy(desc(schema.marketEvents.publishedAt)).limit(30),
    db.select().from(schema.issuerReports).where(and(eq(schema.issuerReports.instrumentId, id))).orderBy(desc(schema.issuerReports.publishedAt)).limit(8),
  ])
  const issuerFundamentals = await loadIssuerFacts(id, new Date())
  return {
    dataQuality: {
      status: verified ? 'verified' : 'data_quality_blocked',
      issues: [...quality.issues, ...benchmarkQuality.issues].slice(0, 10),
    },
    issuerFundamentals,
    financialComparisons: compareFinancialFacts(issuerFundamentals),
    issuerIndustry: issuerIndustry(instrument.isin, instrument.sector),
    bankEvidence: await bankEvidence(id),
    instrument,
    candles: candles.slice(-250),
    signals,
    events,
    reports,
  }
})

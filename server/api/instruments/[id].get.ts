import { bankEvidence } from '../../services/bank-evidence'
import { compareFinancialFacts, issuerIndustry } from '../../domain/evidence/financials'
import { loadIssuerFacts } from '../../services/issuer-fundamentals'
import { db, schema } from '@nuxthub/db'
import { and, desc, eq } from 'drizzle-orm'
import { STRATEGY_IDS } from '../../../shared/types/investment'
import { evaluateSignal } from '../../domain/strategies/rules'
import { benchmarkInstrument, getInstrument, loadCandles, loadResearchBars } from '../../services/market'
import { activeVersion } from '../../services/strategies'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const id = uuidParam(event)
  const instrument = await getInstrument(id)
  const candles = await loadCandles(id, { limit: 400 })
  const benchmark = await benchmarkInstrument()
  const research = await loadResearchBars({
    instrumentId: id,
    asOf: new Date(),
    purpose: 'signal',
    limit: 400,
  })
  const benchmarkResearch = benchmark
    ? await loadResearchBars({
        instrumentId: benchmark.id,
        asOf: new Date(),
        purpose: 'signal',
        limit: 300,
      })
    : null
  const quality = research.quality
  const benchmarkQuality = benchmarkResearch?.quality
  const verified = quality.status !== 'data_quality_blocked' && !!benchmarkResearch && benchmarkQuality?.status !== 'data_quality_blocked'
  const signals = await Promise.all(STRATEGY_IDS.map(async (strategy) => {
    const version = await activeVersion(strategy)
    return {
      strategy,
      version: version.version,
      ...evaluateSignal(strategy, version.rules, verified ? quality.completedBars : [], verified ? (benchmarkQuality?.completedBars ?? []) : []),
    }
  }))
  const [events, reports] = await Promise.all([
    db.select().from(schema.marketEvents).where(eq(schema.marketEvents.instrumentId, id)).orderBy(desc(schema.marketEvents.publishedAt)).limit(30),
    db.select().from(schema.issuerReports).where(and(eq(schema.issuerReports.instrumentId, id))).orderBy(desc(schema.issuerReports.publishedAt)).limit(8),
  ])
  const issuerFundamentals = await loadIssuerFacts(id, new Date())
  return {
    dataQuality: {
      status: verified ? quality.status : 'data_quality_blocked',
      issues: [...quality.issues, ...(benchmarkQuality?.issues ?? ['benchmark_missing'])].slice(0, 10),
    },
    issuerFundamentals,
    financialComparisons: compareFinancialFacts(issuerFundamentals),
    issuerIndustry: issuerIndustry(instrument.isin, instrument.sector),
    bankEvidence: await bankEvidence(id),
    instrument,
    marketData: research.provenance,
    candles: (verified ? research.bars : candles).slice(-250),
    signals,
    events,
    reports,
  }
})

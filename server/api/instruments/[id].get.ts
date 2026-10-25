import { bankEvidence } from '../../services/bank-evidence'
import { compareFinancialFacts, issuerIndustry } from '../../domain/evidence/financials'
import { loadIssuerFacts } from '../../services/issuer-fundamentals'
import { db, schema } from '@nuxthub/db'
import { and, desc, eq } from 'drizzle-orm'
import { STRATEGY_IDS } from '../../../shared/types/investment'
import { evaluateSignal } from '../../domain/strategies/rules'
import { benchmarkInstrument, getInstrument, loadCandles, loadResearchBars, freezeResearchSelection, researchBarSelection } from '../../services/market'
import { loadSignalInputs } from '../../services/signal-inputs'
import { activeVersion } from '../../services/strategies'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const id = uuidParam(event)
  const instrument = await getInstrument(id)
  const candles = await loadCandles(id, { limit: 400 })
  const benchmark = await benchmarkInstrument()
  const asOf = new Date()
  const selection = await freezeResearchSelection(researchBarSelection())
  const research = await loadResearchBars({
    instrumentId: id,
    asOf,
    purpose: 'signal',
    limit: selection.policyId === 'physical_session_v1' ? 210 : 400,
    selection,
  })
  const quality = research.quality
  const signals = await Promise.all(STRATEGY_IDS.map(async (strategy) => {
    const version = await activeVersion(strategy)
    const input = await loadSignalInputs({
      instrumentId: id,
      benchmarkId: benchmark?.id ?? null,
      rules: version.rules,
      asOf,
      selection,
    })
    const eligible = input.dependencies.signalEligibility.status === 'eligible'
    const signal = evaluateSignal(strategy, version.rules, eligible ? input.research.bars : [], input.benchmarkCandles)
    return {
      strategy,
      version: version.version,
      ...signal,
      setup: eligible && signal.setup,
      failures: eligible ? signal.failures : input.dependencies.signalEligibility.issues,
      dependencyQuality: input.dependencies,
    }
  }))
  const [events, reports] = await Promise.all([
    db.select().from(schema.marketEvents).where(eq(schema.marketEvents.instrumentId, id)).orderBy(desc(schema.marketEvents.publishedAt)).limit(30),
    db.select().from(schema.issuerReports).where(and(eq(schema.issuerReports.instrumentId, id))).orderBy(desc(schema.issuerReports.publishedAt)).limit(8),
  ])
  const issuerFundamentals = await loadIssuerFacts(id, new Date())
  return {
    dataQuality: {
      status: quality.status,
      issues: quality.issues.slice(0, 10),
    },
    issuerFundamentals,
    financialComparisons: compareFinancialFacts(issuerFundamentals),
    issuerIndustry: issuerIndustry(instrument.isin, instrument.sector),
    bankEvidence: await bankEvidence(id),
    instrument,
    marketData: research.provenance,
    candles: research.bars.slice(-250),
    rawCandles: candles,
    rawCandlesNote: 'Separate broker-provider history for inspection only; never substituted into the selected research series.',
    signals,
    events,
    reports,
  }
})

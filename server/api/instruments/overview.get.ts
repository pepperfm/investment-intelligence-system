import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { STRATEGY_IDS } from '../../../shared/types/investment'
import { evaluateSignal } from '../../domain/strategies/rules'
import { benchmarkInstrument, loadResearchBars, freezeResearchSelection, researchBarSelection } from '../../services/market'
import { loadSignalInputs } from '../../services/signal-inputs'
import { activeVersion } from '../../services/strategies'

/** Compact per-instrument snapshot for the instruments grid: sparkline, changes and current signals. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const instruments = await db.select().from(schema.instruments).where(eq(schema.instruments.active, true))
  const versions = await Promise.all(STRATEGY_IDS.map(id => activeVersion(id)))
  const benchmark = await benchmarkInstrument()
  const asOf = new Date()
  const selection = await freezeResearchSelection(researchBarSelection())
  return Promise.all(instruments.map(async (instrument) => {
    // Display quality belongs to this instrument and never inherits an optional index failure.
    const research = await loadResearchBars({
      instrumentId: instrument.id,
      asOf,
      purpose: 'signal',
      limit: selection.policyId === 'physical_session_v1' ? 210 : 300,
      selection,
    })
    const quality = research.quality
    const usable = quality.status !== 'data_quality_blocked'
    const closes = research.bars.map(c => c.close)
    const change = (days: number) => closes.length > days ? closes.at(-1)! / closes.at(-1 - days)! - 1 : null
    const signals = instrument.kind === 'equity'
      ? await Promise.all(STRATEGY_IDS.map(async (strategy, i) => {
          const version = versions[i]!
          const input = await loadSignalInputs({
            instrumentId: instrument.id,
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
            setup: eligible && signal.setup,
            setupType: signal.setupType,
            reasons: signal.reasons,
            failures: eligible ? signal.failures : input.dependencies.signalEligibility.issues,
            rewardRisk: signal.rewardRisk,
            dependencyQuality: input.dependencies,
          }
        }))
      : []
    return {
      ...instrument,
      marketData: research.provenance,
      last: closes.at(-1) ?? null,
      lastTs: research.bars.at(-1)?.ts ?? null,
      dataQuality: {
        status: quality.status,
        issues: quality.issues.slice(0, 5),
      },
      change1d: usable ? change(1) : null,
      change20d: usable ? change(20) : null,
      spark: closes.slice(-60),
      signals,
    }
  }))
})

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { STRATEGY_IDS } from '../../../shared/types/investment'
import { evaluateSignal } from '../../domain/strategies/rules'
import { benchmarkInstrument, loadCandles, loadResearchBars } from '../../services/market'
import { activeVersion } from '../../services/strategies'

/** Compact per-instrument snapshot for the instruments grid: sparkline, changes and current signals. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const instruments = await db.select().from(schema.instruments).where(eq(schema.instruments.active, true))
  const versions = await Promise.all(STRATEGY_IDS.map(id => activeVersion(id)))
  const benchmark = await benchmarkInstrument()
  const benchmarkResearch = benchmark
    ? await loadResearchBars({
        instrumentId: benchmark.id,
        asOf: new Date(),
        purpose: 'signal',
        limit: 300,
      })
    : null
  const benchmarkQuality = benchmarkResearch?.quality
  return Promise.all(instruments.map(async (instrument) => {
    const candles = await loadCandles(instrument.id, { limit: 300 })
    const research = await loadResearchBars({
      instrumentId: instrument.id,
      asOf: new Date(),
      purpose: 'signal',
      limit: 300,
    })
    const quality = research.quality
    const verified = quality.status !== 'data_quality_blocked' && !!benchmarkQuality && benchmarkQuality.status !== 'data_quality_blocked'
    const closes = (verified ? research.bars : candles).map(c => c.close)
    const change = (days: number) => closes.length > days ? closes.at(-1)! / closes.at(-1 - days)! - 1 : null
    return {
      ...instrument,
      marketData: research.provenance,
      last: closes.at(-1) ?? null,
      lastTs: candles.at(-1)?.ts ?? null,
      dataQuality: {
        status: verified ? quality.status : 'data_quality_blocked',
        issues: [...quality.issues, ...(benchmarkQuality?.issues ?? ['benchmark_missing'])].slice(0, 5),
      },
      change1d: verified ? change(1) : null,
      change20d: verified ? change(20) : null,
      spark: closes.slice(-60),
      signals: instrument.kind === 'equity'
        ? STRATEGY_IDS.map((strategy, i) => {
            const signal = evaluateSignal(strategy, versions[i]!.rules, verified ? quality.completedBars : [], verified ? (benchmarkQuality?.completedBars ?? []) : [])
            return {
              strategy,
              version: versions[i]!.version,
              setup: signal.setup,
              setupType: signal.setupType,
              reasons: signal.reasons,
              failures: verified ? signal.failures : ['data_quality_blocked: дневные периоды не подтверждены'],
              rewardRisk: signal.rewardRisk,
            }
          })
        : [],
    }
  }))
})

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { STRATEGY_IDS } from '../../../shared/types/investment'
import { evaluateSignal } from '../../domain/strategies/rules'
import { benchmarkInstrument, loadCandles } from '../../services/market'
import { activeVersion } from '../../services/strategies'

/** Compact per-instrument snapshot for the instruments grid: sparkline, changes and current signals. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const instruments = await db.select().from(schema.instruments).where(eq(schema.instruments.active, true))
  const versions = await Promise.all(STRATEGY_IDS.map(id => activeVersion(id)))
  const benchmark = await benchmarkInstrument()
  const benchmarkCandles = benchmark ? await loadCandles(benchmark.id, { limit: 300 }) : []
  return Promise.all(instruments.map(async (instrument) => {
    const candles = await loadCandles(instrument.id, { limit: 300 })
    const closes = candles.map(c => c.close)
    const change = (days: number) => closes.length > days ? closes.at(-1)! / closes.at(-1 - days)! - 1 : null
    return {
      ...instrument,
      last: closes.at(-1) ?? null,
      lastTs: candles.at(-1)?.ts ?? null,
      change1d: change(1),
      change20d: change(20),
      spark: closes.slice(-60),
      signals: instrument.kind === 'equity'
        ? STRATEGY_IDS.map((strategy, i) => {
            const signal = evaluateSignal(strategy, versions[i]!.rules, candles, benchmarkCandles)
            return {
              strategy,
              version: versions[i]!.version,
              setup: signal.setup,
              setupType: signal.setupType,
              reasons: signal.reasons,
              failures: signal.failures,
              rewardRisk: signal.rewardRisk,
            }
          })
        : [],
    }
  }))
})

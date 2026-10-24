import { failInterruptedRuns } from '../services/analysis'
import { ensureStrategies } from '../services/strategies'

/** Seeds reference data only. No analysis is ever started here (manual mode). */
export default defineNitroPlugin(async () => {
  try {
    await ensureStrategies()
    await failInterruptedRuns()
  } catch (error) {
    console.error('Bootstrap failed (database migrated?):', (error as Error).message)
  }
})

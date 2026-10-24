import { syncAll } from '../../services/market'

/** Manual data refresh: quotes, events and reports only; never triggers analysis. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  return syncAll()
})

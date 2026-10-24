import { listStrategies } from '../../services/strategies'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  return listStrategies()
})

import { backtestStrategy } from '../../../services/evaluations'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  return backtestStrategy(strategyParam(event))
})

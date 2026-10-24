import { listEvaluations, strategyStats } from '../../services/evaluations'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const [rows, swing, position, all] = await Promise.all([listEvaluations(), strategyStats('swing'), strategyStats('position'), strategyStats()])
  return {
    rows,
    stats: {
      swing,
      position,
      all,
    },
  }
})

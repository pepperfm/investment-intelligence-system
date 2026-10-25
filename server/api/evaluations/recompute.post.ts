import { z } from 'zod'
import { recomputeEvaluations } from '../../services/evaluations'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const { hypothesisIds } = await readValidatedBody(event, z.object({ hypothesisIds: z.array(z.uuid()).min(1).max(100).optional() }).parse)
  return recomputeEvaluations(hypothesisIds)
})

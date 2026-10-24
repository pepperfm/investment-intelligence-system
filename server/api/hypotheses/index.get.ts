import { z } from 'zod'
import { HYPOTHESIS_STATUSES, STRATEGY_IDS } from '../../../shared/types/investment'
import { listHypotheses } from '../../services/hypotheses'

const query = z.object({
  status: z.string().optional().transform(v => v ? v.split(',') : undefined).pipe(z.array(z.enum(HYPOTHESIS_STATUSES)).optional()),
  strategy: z.enum(STRATEGY_IDS).optional(),
  instrumentId: z.uuid().optional(),
})

export default defineEventHandler(async (event) => {
  await requireUser(event)
  return listHypotheses(await getValidatedQuery(event, query.parse))
})

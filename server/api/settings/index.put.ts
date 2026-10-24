import { z } from 'zod'
import { costModelInput, riskLimitsInput } from '../../../shared/schemas/investment'
import { saveCostModel, saveRiskLimits } from '../../services/settings'

const body = z.object({
  risk: riskLimitsInput,
  costs: costModelInput,
})

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const { risk, costs } = await readValidatedBody(event, body.parse)
  await saveRiskLimits(risk)
  await saveCostModel(costs)
  return { ok: true }
})

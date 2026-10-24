import { getCostModel, getRiskLimits } from '../../services/settings'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const [risk, costs] = await Promise.all([getRiskLimits(), getCostModel()])
  return {
    risk,
    costs,
  }
})

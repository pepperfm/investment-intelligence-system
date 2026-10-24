import { getHypothesis } from '../../../services/hypotheses'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  return getHypothesis(uuidParam(event))
})

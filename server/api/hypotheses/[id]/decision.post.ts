import { hypothesisDecisionInput } from '../../../../shared/schemas/investment'
import { decideHypothesis } from '../../../services/hypotheses'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const id = uuidParam(event)
  const { action, comment } = await readValidatedBody(event, hypothesisDecisionInput.parse)
  return decideHypothesis(id, action, comment)
})

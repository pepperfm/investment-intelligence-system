import { evaluateDue } from '../../services/evaluations'

/** Manual: evaluate matured hypotheses and run outcome_reviewer retrospectives. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  return evaluateDue()
})

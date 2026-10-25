import { evaluateDue } from '../../services/evaluations'

/** Manual: append deterministic scenario/decision evaluation revisions; no implicit AI calls. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  return evaluateDue()
})

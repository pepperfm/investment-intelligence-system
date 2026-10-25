import { reviewOutcome } from '../../../services/evaluations'

/** Explicit AI action, separate from the deterministic evaluation/recompute command. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  return reviewOutcome(uuidParam(event))
})

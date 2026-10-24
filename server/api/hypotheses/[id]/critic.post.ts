import { runCritic } from '../../../services/analysis'

/** Manual re-run of the independent critic (e.g. after a provider failure). */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  return { status: await runCritic(uuidParam(event)) }
})

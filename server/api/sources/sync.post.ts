import { syncEvidence } from '../../services/evidence'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  return syncEvidence()
})

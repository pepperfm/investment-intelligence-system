import { listRuns } from '../../services/analysis'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  return listRuns()
})

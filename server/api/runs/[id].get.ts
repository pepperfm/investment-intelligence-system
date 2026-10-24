import { getRun } from '../../services/analysis'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  return getRun(uuidParam(event))
})

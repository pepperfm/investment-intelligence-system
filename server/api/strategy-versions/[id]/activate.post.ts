import { activateVersion } from '../../../services/strategies'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  return activateVersion(uuidParam(event))
})

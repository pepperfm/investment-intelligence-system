import { getSnapshotPayload } from '../../../services/hypotheses'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  return getSnapshotPayload(uuidParam(event))
})

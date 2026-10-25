import { syncPrimaryDocuments } from '../../../services/primary-documents'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  return syncPrimaryDocuments()
})

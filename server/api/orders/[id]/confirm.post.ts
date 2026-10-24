import { confirmOrder } from '../../../trading/paper-broker'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  return confirmOrder(uuidParam(event))
})

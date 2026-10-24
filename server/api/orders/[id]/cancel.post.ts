import { cancelOrder } from '../../../trading/paper-broker'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  return cancelOrder(uuidParam(event))
})

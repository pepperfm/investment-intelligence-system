import { createOrderInput } from '../../../shared/schemas/investment'
import { previewOrder } from '../../trading/paper-broker'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const body = await readValidatedBody(event, createOrderInput.parse)
  return previewOrder(body)
})

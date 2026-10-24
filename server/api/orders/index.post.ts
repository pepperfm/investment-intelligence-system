import { createOrderInput } from '../../../shared/schemas/investment'
import { createOrder } from '../../trading/paper-broker'

/** Creates a paper order ticket awaiting explicit confirmation. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  return createOrder(await readValidatedBody(event, createOrderInput.parse))
})

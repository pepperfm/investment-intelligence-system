import { proposeFromRetrospectives } from '../../../services/evaluations'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  return proposeFromRetrospectives(strategyParam(event))
})

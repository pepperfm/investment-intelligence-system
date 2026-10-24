import { z } from 'zod'
import { strategyRulesInput } from '../../../../shared/schemas/investment'
import { proposeVersion } from '../../../services/strategies'

const body = z.object({
  rules: strategyRulesInput,
  notes: z.string().trim().max(2000).default(''),
})

/** Manual proposal; activation is a separate explicit step. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const strategy = strategyParam(event)
  const { rules, notes } = await readValidatedBody(event, body.parse)
  return proposeVersion(strategy, rules, notes || 'Ручное предложение', 'user')
})

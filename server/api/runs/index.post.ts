import { startRunInput } from '../../../shared/schemas/investment'
import { startRun } from '../../services/analysis'

export default defineEventHandler(async (event) => {
  const { user } = await requireUser(event)
  const input = await readValidatedBody(event, startRunInput.parse)
  return startRun(user.id, input)
})

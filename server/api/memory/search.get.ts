import { memorySearchInput } from '../../../shared/schemas/investment'
import { searchMemory } from '../../services/memory'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const { q, limit, before } = await getValidatedQuery(event, memorySearchInput.parse)
  return searchMemory(q, {
    limit,
    before: before ? new Date(`${before}T23:59:59Z`) : undefined,
  })
})

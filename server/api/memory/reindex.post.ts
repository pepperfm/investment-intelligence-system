import { reindexMemory } from '../../services/memory'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  return reindexMemory()
})

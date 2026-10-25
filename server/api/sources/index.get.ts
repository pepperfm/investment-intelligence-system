import { listSources } from '../../services/source-status'
import { sourceFetchHistory } from '../../services/evidence'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const [sources, fetches] = await Promise.all([listSources(), sourceFetchHistory()])
  return {
    sources,
    fetches,
  }
})

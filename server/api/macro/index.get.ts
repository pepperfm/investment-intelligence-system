import { z } from 'zod'
import { macroOverview, regulatoryHistory } from '../../services/macro'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const { asOf } = await getValidatedQuery(event, z.object({ asOf: z.iso.datetime({ offset: true }).optional() }).parse)
  const cutoff = asOf ? new Date(asOf) : new Date()
  const [series, events] = await Promise.all([macroOverview(cutoff), regulatoryHistory(cutoff)])
  return {
    asOf: cutoff.toISOString(),
    series,
    events,
  }
})

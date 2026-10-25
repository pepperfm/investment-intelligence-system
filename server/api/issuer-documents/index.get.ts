import { z } from 'zod'
import { loadIssuerFacts } from '../../services/issuer-fundamentals'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const { instrumentId, asOf } = await getValidatedQuery(event, z.object({
    instrumentId: z.uuid(),
    asOf: z.iso.datetime({ offset: true }).optional(),
  }).parse)
  return loadIssuerFacts(instrumentId, asOf ? new Date(asOf) : new Date())
})

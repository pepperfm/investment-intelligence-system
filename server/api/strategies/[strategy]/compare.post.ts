import { z } from 'zod'
import { compareVersions } from '../../../services/evaluations'

const body = z.object({ versionIds: z.array(z.uuid()).min(1).max(4) })

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const strategy = strategyParam(event)
  const { versionIds } = await readValidatedBody(event, body.parse)
  return compareVersions(strategy, versionIds)
})

import { z } from 'zod'
import { saveAiProfile } from '../../services/settings'

const input = z.object({ profile: z.enum(['primary', 'llmost']) })

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const { profile } = await readValidatedBody(event, input.parse)
  if (profile === 'llmost') {
    const health = await providerById('llmost').health()
    if (!health.available) {
      throw createError({
        statusCode: 503,
        statusMessage: health.error ?? 'LLMost unavailable',
      })
    }
  }
  await saveAiProfile(profile)
  return { profile }
})

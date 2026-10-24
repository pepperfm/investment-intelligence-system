import type { H3Event } from 'h3'
import { z } from 'zod'

export function uuidParam(event: H3Event, name = 'id') {
  const value = getRouterParam(event, name)
  const parsed = z.uuid().safeParse(value)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid ${name}`,
    })
  }
  return parsed.data
}

export function strategyParam(event: H3Event) {
  const parsed = z.enum(['swing', 'position']).safeParse(getRouterParam(event, 'strategy'))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid strategy',
    })
  }
  return parsed.data
}

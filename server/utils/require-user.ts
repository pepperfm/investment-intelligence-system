import type { H3Event } from 'h3'
import { getRequestHeaders } from 'h3'

/** Must be called by every protected API. Page middleware is not API protection. */
export async function requireUser(event: H3Event) {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const result = await auth().api.getSession({ headers: new Headers(getRequestHeaders(event) as HeadersInit) })
  if (!result) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthenticated',
    })
  }
  return result
}

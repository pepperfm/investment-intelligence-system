/** UX redirect only; every API endpoint enforces auth itself via requireUser. */
export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') {
    return
  }
  const fetch = useRequestFetch()
  try {
    await fetch('/api/me')
  } catch (error) {
    const status = (error as {
      statusCode?: number
      status?: number
    }).statusCode ?? (error as { status?: number }).status
    if (status === 401) {
      return navigateTo('/login')
    }
    throw error
  }
})

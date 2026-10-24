export default defineEventHandler(async (event) => {
  const { user, session } = await requireUser(event)
  // Deliberately omit the session token and provider credentials from SSR payloads.
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
    session: { id: session.id },
  }
})

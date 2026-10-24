import { createAuthClient } from 'better-auth/vue'
/** Relative URLs keep browser auth requests same-origin. Do not import the server auth module here. */
export const authClient = createAuthClient()

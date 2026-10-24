import type { InternalApi } from 'nitropack/types'

/** Response type of a server route, for dynamic URLs that typed fetch cannot narrow by itself. */
export type ApiResponse<Route extends keyof InternalApi, Method extends keyof InternalApi[Route] = 'get' & keyof InternalApi[Route]> = InternalApi[Route][Method]

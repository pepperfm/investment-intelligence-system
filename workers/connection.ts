import { Redis } from 'ioredis'

/** Ordinary TypeScript: no Nitro imports or request-scoped helpers in a worker. */
export function connection(worker = false) {
  const url = process.env.NUXT_REDIS_STATE_URL
  if (!url) {
    throw new Error('NUXT_REDIS_STATE_URL is required')
  }
  const client = new Redis(url, {
    maxRetriesPerRequest: worker ? null : 1,
    connectTimeout: 5000,
  })
  client.on('error', () => console.error('Queue Redis connection error'))
  return client
}
export function queuePrefix() {
  return (process.env.NUXT_REDIS_PREFIX || 'iis:') + 'bull'
}
export const queueName = 'default'

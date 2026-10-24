import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { redisStorage } from '@better-auth/redis-storage'
import { Redis } from 'ioredis'
import { db, schema } from '@nuxthub/db'

let instance: ReturnType<typeof createAuth> | undefined
let redis: Redis | undefined
function createAuth() {
  const config = useRuntimeConfig()
  if (config.authSecret.length < 32) {
    throw new Error('NUXT_AUTH_SECRET must contain at least 32 characters')
  }
  if (!config.redisStateUrl) {
    throw new Error('NUXT_REDIS_STATE_URL is required for sessions')
  }
  const baseURL = config.public.siteUrl
  if (process.env.NODE_ENV === 'production' && !baseURL.startsWith('https://') && !baseURL.startsWith('http://127.0.0.1:') && !baseURL.startsWith('http://localhost:')) {
    throw new Error('Use HTTPS for NUXT_PUBLIC_SITE_URL in production')
  }
  redis = new Redis(config.redisStateUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
  })
  redis.on('error', () => console.error('Authentication Redis connection error'))
  return betterAuth({
    secret: config.authSecret,
    baseURL,
    trustedOrigins: [baseURL],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema,
    }),
    secondaryStorage: redisStorage({
      client: redis,
      keyPrefix: config.redisPrefix + 'auth:',
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      storeSessionInDatabase: false,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: 'secondary-storage',
      window: 60,
      max: 60,
    },
    advanced: { ipAddress: { ipAddressHeaders: ['x-real-ip'] } },
  })
}
export function auth() {
  return instance ??= createAuth()
}
export async function closeAuth() {
  instance = undefined
  if (redis) {
    redis.disconnect()
    redis = undefined
  }
}

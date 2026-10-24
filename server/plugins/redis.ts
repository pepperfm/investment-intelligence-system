import redisDriver from 'unstorage/drivers/redis'

export default defineNitroPlugin(async (nitroApp) => {
  const config = useRuntimeConfig()
  if (!config.redisCacheUrl || !config.redisStateUrl) {
    throw new Error('NUXT_REDIS_CACHE_URL and NUXT_REDIS_STATE_URL are required; refusing a local cache fallback')
  }
  const storage = useStorage()
  await storage.unmount('cache', true)
  storage.mount('cache', redisDriver({
    url: config.redisCacheUrl,
    base: config.redisPrefix + 'cache',
    maxRetriesPerRequest: 1,
  }))
  storage.mount('kv', redisDriver({
    url: config.redisStateUrl,
    base: config.redisPrefix + 'kv',
    maxRetriesPerRequest: 1,
  }))
  nitroApp.hooks.hook('close', async () => {
    await storage.unmount('cache', true)
    await storage.unmount('kv', true)
  })
})

export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@nuxt/eslint', '@vueuse/nuxt', '@pinia/nuxt', 'nuxt-security', '@nuxthub/core'],
  devtools: {
    enabled: true,
  },
  css: ['~/assets/css/main.css'],
  ui: {
    fonts: false,
  },
  runtimeConfig: {
    public: {
      appName: 'iis',
      siteUrl: 'http://localhost:3000',
    },
    redisCacheUrl: '',
    redisStateUrl: '',
    redisPrefix: 'iis:',
    authSecret: '',
    marketProvider: 'mock',
    finamReadSecret: '',
    finamAccountId: '',
    aiProvider: 'mock',
    aiCriticProvider: 'mock',
    codexBin: 'codex',
    codexModel: '',
    codexReasoningEffort: '',
    claudeBin: 'claude',
    claudeModel: '',
    aiTimeoutMs: 600000,
    embeddingProvider: 'hash',
    embeddingUrl: '',
    embeddingKey: '',
    embeddingModel: '',
  },
  routeRules: {
    '/api/auth/**': {
      headers: {
        'cache-control': 'no-store',
      },
    },
    '/api/me': {
      headers: {
        'cache-control': 'no-store',
      },
    },
    '/api/**': {
      headers: {
        'cache-control': 'no-store',
      },
    },
    '/account': {
      headers: {
        'cache-control': 'no-store',
      },
    },
  },
  devServer: {
    host: '127.0.0.1',
  },
  compatibilityDate: '2026-10-17',
  nitro: {
    preset: 'bun',
  },
  hub: {
    db: {
      dialect: 'postgresql',
      driver: 'postgres-js',
      applyMigrationsDuringBuild: false,
      applyMigrationsDuringDev: false,
    },
  },
  typescript: {
    strict: true,
  },
  eslint: {
    config: {
      stylistic: {
        indent: 2,
        semi: false,
        quotes: 'single',
      },
    },
  },
  security: {
    rateLimiter: false,
  },
})

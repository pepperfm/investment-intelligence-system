export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@nuxt/eslint', '@vueuse/nuxt', '@pinia/nuxt', 'nuxt-security', '@nuxthub/core'],
  devtools: {
    enabled: true,
  },
  app: {
    head: {
      title: 'IIS · Личный исследовательский стол',
      htmlAttrs: { lang: 'ru' },
      meta: [
        {
          name: 'description',
          content: 'Личный исследовательский стол: акции MOEX, гипотезы и независимая проверка решений.',
        },
        {
          name: 'application-name',
          content: 'IIS',
        },
        {
          name: 'apple-mobile-web-app-title',
          content: 'IIS',
        },
        {
          name: 'theme-color',
          content: '#18181b',
        },
      ],
      link: [
        {
          rel: 'icon',
          href: '/favicon.ico',
          sizes: '16x16 32x32 48x48',
        },
        {
          rel: 'icon',
          type: 'image/svg+xml',
          href: '/favicon.svg',
        },
        {
          rel: 'apple-touch-icon',
          href: '/apple-touch-icon.png',
          sizes: '180x180',
        },
        {
          rel: 'manifest',
          href: '/site.webmanifest',
        },
      ],
    },
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
    finamSymbols: '',
    aiProvider: 'mock',
    aiCriticProvider: 'mock',
    codexBin: 'codex',
    codexModel: '',
    codexReasoningEffort: '',
    codexResearcherModel: '',
    codexResearcherEffort: '',
    codexAnalystModel: '',
    codexAnalystEffort: '',
    codexCriticModel: '',
    codexCriticEffort: '',
    codexReviewerModel: '',
    codexReviewerEffort: '',
    claudeBin: 'claude',
    claudeModel: '',
    llmostBaseUrl: 'https://llmost.ru/api/v1',
    llmostApiKey: '',
    llmostResearcherModel: '',
    llmostResearcherEffort: '',
    llmostAnalystModel: '',
    llmostAnalystEffort: '',
    llmostCriticModel: '',
    llmostCriticEffort: '',
    llmostReviewerModel: '',
    llmostReviewerEffort: '',
    aiTimeoutMs: 600000,
    pdfTextBin: 'pdftotext',
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
    requestSizeLimiter: {
      maxRequestSizeInBytes: 21_000_000,
      maxUploadFileRequestInBytes: 21_000_000,
    },
  },
})

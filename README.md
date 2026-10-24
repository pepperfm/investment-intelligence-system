# IIS — Investment Intelligence System

Локальная персональная система исследования акций MOEX: ручной запуск анализа, Codex-агенты с обязательной
независимой проверкой гипотез, история решений, RAG-память на pgvector, оценка исходов, ретроспективы и paper trading.
**Не автотрейдер: реальные заявки не реализованы.**

- Требования: [INVESTMENT_ARCHITECTURE_PLAN.md](INVESTMENT_ARCHITECTURE_PLAN.md)
- Решения, прогресс, блокеры: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)

## Быстрый старт (mock-режим, без ключей)

```sh
bun install
bun run services:up      # Postgres+pgvector :5442, Redis cache :6392, state :6393
bun run db:migrate
bun run dev              # http://localhost:3000 (слушает 127.0.0.1)
```

1. Зарегистрируйтесь на `/login` (локальный пользователь).
2. «Обзор» → «Обновить данные» (синтетические котировки, события, отчётность).
3. «Исследования» → выберите инструменты и стратегии. Для мгновенной ретро-оценки укажите дату в прошлом.
4. Карточка гипотезы → решение → (для одобренной long-идеи) paper-заявка → подтверждение.
5. «Оценки и ретро» → «Оценить созревшие гипотезы»; «Стратегии» → бэктест, предложение версии, walk-forward.

## Провайдеры

| Переменная | Значения |
| --- | --- |
| `NUXT_MARKET_PROVIDER` | `mock` (по умолчанию) · `finam` (+ `NUXT_FINAM_READ_SECRET`, `NUXT_FINAM_ACCOUNT_ID`) |
| `NUXT_AI_PROVIDER` | `mock` · `codex` (локальный `codex exec`) · `claude` |
| `NUXT_AI_CRITIC_PROVIDER` | `mock` · `codex` · `claude` (cross-provider review) |
| `NUXT_EMBEDDING_PROVIDER` | `hash` (локально) · `openai` (OpenAI-совместимый endpoint, 256 измерений) |
| `NUXT_CODEX_MODEL`, `NUXT_CODEX_REASONING_EFFORT` | модель и усилие Codex для агентов (`~/.codex/config.toml` агентами не читается) |

Роли агентов — `.codex/agents/*.toml` (кэшируются процессом: после правки перезапустите сервер). Каждый вызов — отдельный
процесс `codex exec --sandbox read-only --ephemeral --ignore-user-config --output-schema …` в пустой временной директории,
без секретов в окружении.

## Интерфейс

- ⌘K — поиск по разделам, инструментам, гипотезам и действиям; ⌘B — свернуть сайдбар.
- Темы: светлая / тёмная / как в системе (сайдбар, ⌘K, «Настройки»).
- Пароль локального пользователя — от 8 символов.

## Миграции

Миграции лежат в `server/db/migrations` и коммитятся. `bun run db:generate` нужен только после изменения схемы
в `server/db/schema` — сгенерированный SQL проверить и закоммитить. В production не генерировать.

## Технические заметки каркаса

Каркас — PepperFM Nuxt Starter 0.1.0, Nitro preset **bun**. Bun — runtime и менеджер пакетов; Node 22+ нужен для
Vue typecheck. `.env` создаётся локально и не коммитится; секрет авторизации — не короче 32 символов.

- Nuxt Security headers are enabled. Its in-memory rate limiter is disabled; auth has its own Redis-backed limiter. Review CSP and trusted proxies per deployment.
- Builds never modify the database; apply migrations with `bun run db:migrate`.
- Cache and durable state use separate Redis instances, not just different Redis databases. Cache may evict; sessions/queues use noeviction and AOF. URLs are read at runtime, not embedded into build artefacts.
- Auth sessions live in Redis (no DB fallback, no cookie cache). Clearing durable Redis signs users out. /api/me is server-protected and does not serialize tokens; device tokens are loaded client-side only for revocation. Email verification, password reset mail and OAuth credentials are deliberately not configured yet. Add those before a public launch.
- Run schedule:register once per deployment; do not register schedules inside HTTP handlers. The worker is a separate Bun process. A scheduler queues work but does not guarantee exact wall-clock execution under load. Add domain-level idempotency before using real side effects.

## Verify and build

```sh
bun run typecheck
bun run typecheck:worker
bun run test
bun run lint
bun run build
bun run start
```

## Background work

The queue worker is optional for this app (analysis runs on explicit command in the app process). In separate terminals run `bun run worker` and `bun run queue:demo`. Register recurring tasks once with `bun run schedule:register`. All run on Bun; queues are not in the HTTP process.

See deploy/README.md for Ubuntu deployment examples. Nothing is deployed automatically.

## Ownership

This is generated application source, not a runtime dependency on the generator. Commit the installed lockfile and review dependency updates in CI. The starter is a foundation, not a turnkey production security or delivery policy.

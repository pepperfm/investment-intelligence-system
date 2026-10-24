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

### Реальные данные Finam

`NUXT_MARKET_PROVIDER=finam` использует серверный REST-адаптер: каталог с пагинацией,
спецификации лотов, завершённые дневные свечи и чтение счёта. Нужны
`NUXT_FINAM_READ_SECRET` и `NUXT_FINAM_ACCOUNT_ID`. Токен остаётся на сервере;
адаптер не выставляет и не отменяет заявки. `NUXT_FINAM_SYMBOLS` задаёт тикеры через запятую;
`IMOEX@MISX` добавляется автоматически. Пустое значение выбирает все активные акции MISX.

Для перехода с mock используйте отдельную БД и выполните в ней `bun run db:migrate`.
Не переиспользуйте синтетические свечи, новости, отчётность, ретроспективы и калибровку;
синхронизация откажется менять источник у уже сохранённых инструментов.
Локальный переход 2026-10-25 использует `iis_finam`; исходная БД `iis` и игнорируемый
`.env.mock` сохраняют предыдущий режим. Пользователи и настройки перенесены, исследования — нет.

### Новости и финансовая отчётность

Ручное обновление данных в Finam-режиме также загружает:

- RSS корпоративных новостей Finam.ru: заголовок, краткое описание, ссылка и дата публикации.
  Привязка к эмитенту — по тикеру и явным названиям; sentiment не придумывается.
- Годовые и квартальные таблицы МСФО Smart-Lab: прибыль, выручка, денежные потоки,
  активы, капитал, долг и банковские показатели при наличии. Денежные значения переводятся
  в рубли по явно указанным единицам; отсутствующие значения не заменяются нулями.

Smart-Lab — **вторичный источник**. Ссылка «Отчёт» ведёт на документ, указанный агрегатором,
«Таблица» — на страницу извлечения. PDF автоматически не читается и не сверяется с таблицей.
Не импортируются LTM и зависящие от котировок оценочные мультипликаторы.
Для компаний без RUB-таблиц и для других стандартов отчётности покрытие не гарантируется.

`issuer_reports.published_at` хранит дату отчёта (если источник даёт только день — конец дня по Москве),
`available_at` — время первого получения конкретной версии чисел. Изменение значений создаёт
новый snapshot; прошлые строки не переписываются. Для новостей учитывается `retrieved_at`.
Исторический анализ видит только уже наблюдавшиеся системой версии; импорт сегодня не делает
таблицы достоверным point-in-time источником за прошлые годы.

Публичные страницы кэшируются на 15 минут. RSS содержит лишь текущую ленту, а не архив за три года;
отсутствие новости в ней не означает отсутствия риска. Ошибки источников возвращаются в `sourceErrors`
и показываются при обновлении; успешная загрузка котировок не маскирует отсутствие отчётности.
Новости и отчёты сохраняются также в памяти с датой доступности. `hash` остаётся лексическим
feature hashing, не семантической моделью. Автоматический запуск AI по данным отсутствует.

После обновления кода примените миграции `bun run db:migrate` к выбранной базе, в том числе при возврате
к сохранённой mock-базе. Схема расширена полями времени доступности и ссылки на документ.

### Модели по ролям

Переменные `NUXT_CODEX_{RESEARCHER,ANALYST,CRITIC,REVIEWER}_{MODEL,EFFORT}` переопределяют
общие `NUXT_CODEX_MODEL` / `NUXT_CODEX_REASONING_EFFORT`. Пустые значения наследуют общую настройку.
Локально выбраны: researcher — `gpt-6-luna`/medium, analyst — `gpt-6.1-sol`/high,
critic — `gpt-6-astra`/high, reviewer — `gpt-6.1-sol`/medium. Модели показываются в настройках.
CLI health проверяет наличие исполняемого файла, а не доступ аккаунта к каждой модели.

### Оценка результатов

Симулятор исполняет гэп через стоп/цель по открытию, в том числе в день входа.
Для внутридневного лимитного входа максимум дневной свечи не доказывает достижение цели после входа.
Верхняя граница бэктеста исключающая: IS-сделки не используют свечи на границе OOS или после неё.
Повторное сравнение версий на одном OOS не превращает его в новую независимую проверку.

Все оценки гипотез — сценарные, включая одобренные идеи. Фактические paper-исполнения хранятся отдельно.
Paper market-заявка ждёт первую дневную свечу строго после подтверждения и использует её открытие
с учётом спреда/проскальзывания. Лимитная — только касание на последующей свече, без старого close.
На дневных данных исполнения не моделируют внутридневную очередь, ликвидность и частичные fills.

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

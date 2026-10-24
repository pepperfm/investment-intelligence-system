---
name: iis-strategy-workflow
description: >-
  Guides changes to IIS trading-strategy rules: adding or changing a rule parameter (StrategyRules,
  strategyRulesInput, DEFAULT_RULES, evaluateSignal, strategies UI), releasing a new strategy version
  (proposed → user activation), calibrating parameters on in-sample data only and comparing versions
  walk-forward without look-ahead. Use when the task mentions strategy rules, Swing/Position parameters,
  calibration, backtest, walk-forward, strategy versions, minRewardRisk, regimeSma, allowPullback,
  or "подобрать/откалибровать параметры", "новая версия правил", "сравнить версии".
argument-hint: "[add-param|new-version|calibrate|compare] <описание>"
metadata:
  author: iis
  version: "1.0"
  category: domain
---

# Работа с правилами стратегий IIS

Правила стратегий — детерминированный код. LLM их не считает и не меняет. Любое изменение правил
проходит через **версии** (`strategy_versions`), а решение об активации всегда принимает пользователь.

Перед работой прочитай: `AGENTS.md` (раздел Investment system rules), `IMPLEMENTATION_PLAN.md`
(решения D11, D19, D22, D24, D26), `RESULTS_SUMMARY.md` (история калибровки v1→v6).

## Инварианты (нарушение = баг)

1. **Версии неизменяемы.** Никогда не правь `rules` существующей версии и активные правила «на месте».
   Новое поведение — только новая версия `proposed` через `proposeVersion` / `POST /api/strategies/:strategy/versions`.
2. **Активирует пользователь.** `activateVersion` вызывается только по явной просьбе пользователя.
   Прошлые гипотезы хранят свой `strategy_version_id` и не переписываются.
3. **Отсутствующее поле = дефолт.** Новые параметры в `StrategyRules` — опциональные; поведение старых версий
   определяется значением по умолчанию (`?? DEFAULT_…`). Проверь, как дефолт меняет старые версии
   (пример: `minRewardRisk` по умолчанию 1.2 «выключил» v3 с R/R 1:1).
4. **Point-in-time.** Сигнал, бэктест и пакет агентов видят только данные `<= as_of`. Ряд индекса для сигнала
   обрезается по дате последней свечи инструмента; бэктест в пакете — `trackRecord(..., asOf)`.
5. **Подбор только на in-sample.** Параметры выбираются на периоде до границы walk-forward. Out-of-sample — только
   проверка; выбирать вариант по OOS-результату запрещено (это утечка будущего).
6. **Hard gate не трогаем.** Кодовая валидация (`validateHypothesis`, порог `minRewardRisk` версии) и вердикт
   критика решают статус через `gateStatus`. Не ослабляй проверки, чтобы «пропустить» версию — сначала спроси пользователя.
7. **Режим manual.** Никаких автоматических прогонов анализа/калибровки из плагинов, таймеров, хуков.

## Сценарий A — добавить или изменить параметр правил

Обнови все места согласованно:

| Место | Что сделать |
| --- | --- |
| `shared/types/investment.ts` → `StrategyRules` | Опциональное поле с JSDoc: смысл и дефолт. Булево — исключить из `NumericRuleKey`. |
| `shared/schemas/investment.ts` → `strategyRulesInput` | zod-правило с границами и `.default(...)`. |
| `server/domain/strategies/rules.ts` | Значение в `DEFAULT_RULES` (swing и position); логика в `evaluateSignal` с понятными `reasons`/`failures` на русском. |
| `server/domain/evaluations/backtest.ts` | Если параметру нужны новые данные (пример: индекс для `regimeSma`) — передать их point-in-time. |
| `server/services/analysis.ts` | Если параметр не используется версией — убрать его из пакета агентов (`activeRuleSet`), иначе слабая модель примет его за фильтр. |
| `server/services/evaluations.ts` → `proposeFromRetrospectives` | Нечисловые поля не масштабировать (guard `typeof === 'number'`); целочисленные — в `INTEGER_KEYS`. |
| `app/pages/strategies.vue` | `RULE_LABELS`, `RULE_GROUPS`, `DEFAULTS`; булево — `USwitch`, а не `UInputNumber`. |
| `tests/strategy-risk.test.ts` | Тест: параметр включён/выключен, дефолт для старых версий, отсутствие утечки будущего. |

Миграция БД не нужна: правила хранятся в JSONB. Если всё же меняешь схему таблиц — `bun run db:generate`, проверь SQL.

## Сценарий B — выпустить новую версию

1. Возьми правила базовой версии через `GET /api/strategies` (не из памяти).
2. Измени только нужные поля, остальные скопируй как есть.
3. Создай версию: `POST /api/strategies/:strategy/versions` с `{ rules, notes }`.
   В `notes` — что изменено, почему, на каком периоде подбирали и ключевые in-sample цифры.
4. Сравни walk-forward (сценарий D) и покажи пользователю таблицу. Не активируй без его решения.

## Сценарий C — калибровка

Подробный порядок и шаблон скрипта — [references/calibration.md](references/calibration.md). Кратко:

1. Граница — та же, что у `walkForwardCompare` (60% дат после прогрева `WARMUP = 210`).
2. Сетка небольшая и осмысленная; минимум сделок на in-sample (Swing ≥ 80, Position ≥ 20 — иначе выборка — шум).
3. Критерий выбора формулируй **до** расчёта: доходность, PF, реалистичность цели (доля выходов по цели vs стопу)
   или устойчивость соседних значений. Лучший вариант по одной метрике — кандидат на подгонку; добавляй его как контроль.
4. Если ни один вариант не прибылен на in-sample — проблема в сетапе, а не в уровнях; так и скажи.
5. Если выборка мала или режим рынка на OOS не позволяет проверить идею (пример: фильтр режима при росте рынка) —
   вывод «неубедительно», версию не рекомендуй.

## Сценарий D — сравнение версий

`POST /api/strategies/:strategy/compare` с `{ versionIds: [...] }` (до 4 версий). Покажи для каждой версии
in-sample и out-of-sample: сделки, нетто, PF, сверх индекса; при необходимости — доли выходов по цели/стопу/времени.
Обязательно отметь: рост всех версий на OOS может быть эффектом рынка, а не правил; отставание от индекса.

## Проверки после изменений

```bash
bun run typecheck
bun run typecheck:worker
bun run test
bun run lint
bun run build
```

После правки `.codex/agents/*.toml` или серверного кода — перезапусти dev-сервер (роли кэшируются).

## Чего не делать

- Не активировать версии и не запускать платные прогоны Codex без просьбы пользователя.
- Не менять порог валидации или поведение критика ради прохождения версии.
- Не выдавать результаты на mock-данных за выводы о реальном рынке.

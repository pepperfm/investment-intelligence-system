# Калибровка параметров стратегии

## Почему отдельный скрипт

`POST /api/strategies/:strategy/compare` сравнивает уже созданные версии. Для перебора сетки удобнее
одноразовый скрипт в scratchpad, который вызывает чистые доменные функции напрямую — без БД и без
создания десятков версий.

## Данные

- В mock-режиме ряды детерминированы: `new MockMarketDataProvider(() => <дата синхронизации>)` даёт те же
  свечи, что лежат в БД после «Обновить данные».
- Для Finam используй данные из БД (`loadCandles`) через API или серверный контекст — не перезагружай историю у брокера.
- Бенчмарк — `IMOEX@MISX`; он нужен и для доходности сверх индекса, и для `regimeSma`.

## Граница in-sample / out-of-sample

Повтори логику `walkForwardCompare` (`server/domain/evaluations/backtest.ts`):

```ts
const dates = [...new Set(series.flatMap(s => s.candles.slice(210).map(c => c.ts)))].sort()
const splitAt = dates[Math.floor(dates.length * 0.6)]!
// in-sample:  backtest(strategy, rules, series, bench, costs, undefined, splitAt)
// out-of-sample (только для проверки выбранного): backtest(..., splitAt, undefined)
```

## Шаблон скрипта

```ts
import { MockMarketDataProvider } from '<repo>/server/adapters/market/mock'
import { backtest } from '<repo>/server/domain/evaluations/backtest'
import { DEFAULT_RULES } from '<repo>/server/domain/strategies/rules'
import { DEFAULT_COSTS } from '<repo>/server/domain/risk/limits'

const market = new MockMarketDataProvider(() => new Date('<YYYY-MM-DD>T12:00:00Z'))
const list = (await market.listInstruments()).filter(i => i.kind === 'equity')
const from = new Date(Date.now() - 3 * 365 * 86_400_000)
const series = await Promise.all(list.map(async i => ({
  symbol: i.symbol,
  candles: await market.getCandles(i.symbol, from, new Date()),
})))
const bench = await market.getCandles('IMOEX@MISX', from, new Date())
// splitAt — см. выше
const base = { ...DEFAULT_RULES.swing /* или правила текущей активной версии */ }
for (const targetAtr of [2, 3, 4]) {
  const rules = { ...base, targetAtr }
  const { stats, trades } = backtest('swing', rules, series, bench, DEFAULT_COSTS, undefined, splitAt)
  const tp = trades.filter(t => t.exitReason === 'take_profit').length / Math.max(trades.length, 1)
  console.log(targetAtr, stats.traded, stats.avgNetReturn, stats.profitFactor, stats.avgExcessReturn, tp)
}
```

Запуск: `bun <scratchpad>/calibrate.ts` из корня проекта. Скрипт не коммитится.

## Как выбирать

| Критерий | Когда уместен |
| --- | --- |
| Средняя нетто-доходность и PF | Базовый, при достаточной выборке |
| Реалистичность цели (доля выходов по цели ≈ или > по стопу) | Когда большинство сделок закрывается по времени |
| Устойчивость соседних значений | Всегда как проверка: одиночный пик — подгонка |
| Контрольный вариант «лучший по одной метрике» | Добавляй в сравнение, чтобы показать риск подгонки |

## Как докладывать

- Таблица in-sample по сетке (сделки, нетто, PF, сверх индекса, доля целей).
- Выбранный вариант и **заранее заявленный** критерий.
- Walk-forward выбранного против активной версии (и контрольного варианта).
- Явные оговорки: размер выборки, эффект режима рынка на OOS, отставание от индекса, синтетические данные.
- Запись итогов в `IMPLEMENTATION_PLAN.md` (раздел калибровки) и при необходимости в `RESULTS_SUMMARY.md`.

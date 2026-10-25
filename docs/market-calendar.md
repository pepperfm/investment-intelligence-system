# MOEX dates and Finam daily data

Verified on 25 October 2026. This is a local, versioned schedule table, not a calendar polling service.
No existing candles or hypotheses are rewritten.

## Two different dates

A physical Moscow `sessionDate` identifies when trades happen. A logical `tradingDate`
identifies the exchange trading day. The [official stock-session description](https://www.moex.com/a8920)
and [2026 weekend schedule](https://www.moex.com/n95564) assign additional weekend sessions to
the following regular trading day. They specify 09:50–19:00 Moscow for eligible instruments.
A market-wide weekend schedule does not establish admission of an individual security/board.
`inspectSession()` therefore returns `unknown` without an explicit verified eligibility flag.
It does not invent a universal weekday opening time.

The compatibility helpers `addTradingDays`, `tradingDaysBetween`, `isTradingDay` operate on
UTC-midnight **date labels**, counting each regular logical trading day once. They do not count
Saturday and Sunday as two extra trading days. Physical instants use `moscowDate()` / `inspectSession()`.
For 25–29 September the logical sequence is 25, 28, 29 September; physical sessions on
26–27 September belong to 28 September. Ten logical days after 25 September is 9 October.
The model does not claim that an eligible instrument's next physical opening is Monday.
Unverified daily data blocks the executable scenario instead of making that claim.

## Schedule versions and scope

`moex-stocks-2026-v2` includes holidays and additional holiday sessions from
[30 December 2025](https://www.moex.com/n96571), plus the
[4 September amendment](https://www.moex.com/n103931): 28–29 November closed,
5–6 December open for eligible securities. Before that amendment's publication,
`CalendarOptions.asOf` selects `moex-stocks-2026-v1` with the previous December closures.
24–25 October have no sessions. 23 February, 1 May, 12 June, 4 November are additional
sessions; 1–2/7 January and 31 December are closed. Published regular holiday sessions
on 5–6/8–9 January, 9 March, 11 May remain regular logical dates.

Supported scope: MOEX stocks, 2026, declared stock/index boards. Unknown years, boards,
or a knowledge cutoff before the verified holiday publication raise `CalendarUnavailableError`.
`staleDays` counts logical elapsed days and returns Infinity on unknown schedules.
`mock-weekday-v1` is an explicitly separate synthetic model for old mock history;
it is never evidence of actual MOEX sessions. There is no automatic transfer between providers.

## Actual raw comparison

Manual command (no DB writes, no orders, no AI):

```sh
bun scripts/calendar-smoke.ts --live --record
```

Results in `tests/fixtures/calendar/daily-feed-probe.json` are allowlisted public market fields
only. The configured read credential is used in memory; auth responses, headers, account information,
and opaque error bodies are not saved. These are real observations, not synthetic expected prices.

| Instrument | Finam status / rows | MOEX status / rows | Weekend comparison |
| --- | --- | --- | --- |
| ROSN@MISX / TQBR | 200 / 13 | 200 / 12 | All OHLCV agree on 19, 20, 26, 27 September |
| NVTK@MISX / TQBR | 200 / 13 | 200 / 12 | All OHLCV agree on those four dates |
| TATN@MISX / TQBR | 200 / 13 | 200 / 12 | All OHLCV agree on those four dates |

On weekdays open prices and volumes sometimes differ. For example, 28 September
ROSN volume is 11,568,773 at Finam vs 11,572,990 at MOEX; weekend volumes are 801,050
and 418,234 in both. These observations do not prove which weekday sessions each provider includes.
Presence of actual weekend trades supports trading activity for these symbols on those dates,
but is not a versioned historical admission record. The probed current securities endpoint
returned SECID/BOARDID and omitted the requested TRADINGSESSION field.

Finam daily timestamps are 04:00 UTC including weekends. Its raw response also contains
30 September 04:00 UTC despite requested exclusive end 30 September 00:00 UTC.
The adapter's interval filter must remain; this raw observation does not change the documented
[Finam REST contract](https://api.finam.ru/docs/rest): daily depth 365 days,
start inclusive/end exclusive, OHLCV and timestamp. That documentation does not establish
completion times, adjustment policy, or whether weekend amounts overlap Monday aggregation.

MOEX daily `begin/end` labels also cannot be read as actual execution bounds:
weekend rows end around 23:59 Moscow while the published physical session ends at 19:00.
No independent intraday tape was fetched; therefore overlap, precise last included trade and
publication latency remain unverified. Neither a weekday label nor a matching closing price
is proof of a complete, non-overlapping daily feed.

## Enforced data-quality policy

Chosen calculation model: **completed, non-overlapping logical trading-day bars**.
`inspectBarQuality()` requires a verified trading-date timestamp contract, an explicit adjustment
policy, provenance URLs and per-period `completedAt` / `availableAt`. It rejects duplicate dates,
unordered periods, unknown schedules, invalid OHLCV and contradictory availability times.
It filters by both actual completion and availability relative to `asOf`, not by trading date alone.
A Monday aggregate completed after Friday `2026-09-25T20:59:59Z` cannot enter that analysis.
`trading-day-v1` is the normalization version; it validates a declared normalized series,
it does not silently aggregate or remove legacy rows.

**External blocker:** no verified Finam D-bar aggregation/completion contract exists yet.
Consequently legacy Finam rows produce `data_quality_blocked` and no accepted calculation series.
They remain available for viewing/audit. Do not manufacture completion from 04:00 UTC,
remove weekend rows to turn the gate green, or sum them into Monday without evidence.
Resolving this requires provider confirmation or an independently reconciled, complete
intraday feed with dated instrument admission and publication/completion policy.

The gate cannot be unlocked by this probe. A future adapter must supply an independently
verified contract and persist its version alongside snapshots; existing results retain their originals.
Calendar tests cover schedules, versions, ten-day horizons, admission unknown/false,
UTC/Moscow distinction, duplicate periods and Friday cutoff of a future Monday aggregate.

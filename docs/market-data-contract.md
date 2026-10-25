# Research price source contract

## Decision and scope

The working candidate is `MOEX ISS / physical_session_v1`, checked independently against
hourly observations for **each instrument, board and physical date**. The broker provider
remains Finam. Finam D-bars retain `legacy-utc-date-unverified`; the successful MOEX
comparison does not upgrade them. Logical trading-day aggregation is a different policy
and is not enabled by this evidence.

A usable MOEX observation is `research_usable_with_limits`, never a universal `verified`
flag. It is a reconstructed source-native market observation, not proof of the prices
or schedule that IIS actually saw historically. Provider adjustment history and first
historical publication time remain unknown. No adjusted close, split factor, dividend
factor or foreign-provider price is inserted by the research adapter.

## Endpoints and fields

| Kind | Market / board | Source |
| --- | --- | --- |
| ROSN, NVTK, TATN, SBER, GAZP equities | `stock/shares/TQBR` | `/iss/engines/stock/markets/shares/boards/TQBR/securities/{ticker}/candles.json` |
| IMOEX index | `stock/index/SNDX` | `/iss/engines/stock/markets/index/boards/SNDX/securities/IMOEX/candles.json` |
| Logical history | Same market and board | Prefix preceding path with `/iss/history/`, remove `/candles` suffix |

Candle queries specify `from`, `till`, `interval=24` or `interval=60`, `start` and
`iss.meta=off`. Parse the returned `columns` rather than assuming positions. Candle
mapping is `begin/end/open/high/low/close/volume/value`. The live adapter consumes OHLCV;
probe also retains turnover `value` for comparison. History has uppercase OHLCV and
`TRADEDATE`, `TRADINGSESSION` where supplied. Finish pagination, including an empty final
page; a failed/truncated/repeated page cannot establish complete coverage.

The [MOEX ISS manual](https://www.moex.com/files/4be999zbzp80bx2bgmwayrtyx0) describes the
public service. Its existence alone does not verify any period. The empirical table
reconciliation below supplies the bounded aggregation evidence.

## Actual probe and reproducible evidence

Run manually; all commands are market reads only, without DB bootstrap, orders or AI:

```sh
bun scripts/calendar-smoke.ts --live --record
bun scripts/market-contract-probe.ts --live --record
bun scripts/market-contract-probe.ts --live --conflicts --record
bun scripts/moex-series-smoke.ts --live --record
bun run test tests/market-probe-fixtures.test.ts
```

`calendar-smoke` optionally uses the existing Finam read credential only in memory and
saves allowlisted market fields. It never saves JWT/auth responses, headers or account
identifiers. MOEX probes are public and require no credentials.

Recorded public fixtures:

- `tests/fixtures/calendar/daily-feed-probe.json`: original three-symbol probe, preserved.
- `tests/fixtures/calendar/daily-feed-probe-v2.json`: six symbols, raw Finam timestamps,
  independent MOEX daily data, actual observation times and response hashes.
- `tests/fixtures/calendar/moex-reconciliation.json`: six instruments × four ranges,
  full paginated daily/hourly/history tables, endpoints, observation times, response hashes,
  field mappings, per-physical-date conclusions, logical-history comparison and unknowns.
- `tests/fixtures/calendar/moex-conflicts.json`: independently re-fetched ROSN/IMOEX
  conflict periods and controls; offline tests assert quarantine on the actual mismatches.

For the pagination probe, `sourceResponseHash` is SHA256 of newline-joined ordered page
response SHA256 values. The runtime adapter independently hashes canonical parsed tables
and their ordered page hashes. These are different explicitly defined hash domains;
never compare them as if they were hashes of identical bytes.

Ranges: 18–29 September 2026, 23–27 September 2024, 28 February–10 March 2025,
1–9 January 2026. All 176 observed daily OHLCV rows reconcile with the ordered hourly
series on the same Moscow date: 150 equity rows and 26 index rows. Every hourly interval
ends on its own physical date and begins after the previous interval ends. The raw
hourly tables are retained, so this conclusion can be recomputed offline.

For each of five equities all checked turnover sums also match. IMOEX OHLC matches,
reported share volume is zero/inapplicable; turnover differs on six September dates.
That index `value` is not certified as traded turnover or used as equity liquidity.
IMOEX has no rows for 19–20 September in this response, while equities do; no index
bar or index admission is invented for those dates.

### Physical vs logical proof on 26–28 September

ROSN physical volumes:

| Physical date | MOEX daily volume |
| --- | ---: |
| 26 September | 801,050 |
| 27 September | 418,234 |
| 28 September | 11,572,990 |

Each equals the sum of hourly observations on that physical date. MOEX history for
logical `TRADEDATE=2026-09-28` reports **12,792,274**, exactly the sum of these three
physical rows. Its open is Saturday's 360.6; the physical Monday opens at 361.8.
History high/low/close also reconcile to the three physical dates. Therefore using
history Monday alongside weekend daily bars would double-count weekend trades;
using only independently reconciled physical daily bars does not.

Finam Monday volume is 11,568,773 and its daily timestamps are 04:00 UTC. Weekday
OHLCV can differ from MOEX even when Close agrees. Raw Finam also returns an extra bar
outside the requested exclusive interval in the recorded response. Keep the explicit
interval filter and raw duplicates; none of these observations verifies Finam's contract.
[Finam REST documentation](https://api.finam.ru/docs/rest/) defines daily bars and
inclusive/exclusive bounds but does not prove the missing aggregation/completion facts.

## Deterministic per-period policy

For a complete response pair, group by physical `begin` date, preserve original order,
and retain all raw duplicates. Require exactly one daily row, a nonempty hourly group,
finite valid OHLCV, known equity/index board pairing, well-formed Moscow timestamps,
ordered non-overlapping hourly bounds and no cross-date interval. Recompute first open,
maximum high, minimum low, last close and summed volume. Compare all five fields with
a numeric tolerance suitable for JSON decimal representation. A mismatch, duplicate,
partial response or absent hourly confirmation quarantines that period. HTTP 200 or
matching Close alone is insufficient. Market gaps outside a requested window do not
invalidate another window; an included quarantine cannot be dropped silently.

The observed date is a physical price-period fact. It does not prove historical
advance admission to weekend trading, and absence of a row does not prove closure.
Session durations/counts require the corresponding scoped coverage and clock.

Current reconstruction guard uses `earliestUseAt = Moscow date midnight + two days`.
This intentionally conservative finalization buffer is an application eligibility
policy, **not a provider-confirmed last-trade or first-publication timestamp**.
`observedAt/availableAt` retain actual first observation. Historical use is allowed only
in explicitly marked reconstruction, never as a claim that IIS possessed the quote then.
At historical Friday 25 September 23:59:59 Moscow, a future Monday aggregate and the
Friday bar still inside this buffer are excluded. Reports/events retain their stricter
published/observed cutoff; reconstructed prices do not backdate fundamental evidence.

`historicalAvailability=unknown`, `reconstruction=true` and adjustment limits remain
visible in the snapshot. These limitations prohibit using this policy as live paper-fill
proof. A future policy with confirmed session close/publication can have another revision;
old observations, hypotheses, snapshots and evaluations remain intact.

## Full-window live smoke and real anomalies

`MoexIssResearchProvider.getSeries` was also called for 1 January 2024–23 October 2026.
Only metrics are stored in ignored `tmp/moex-series-smoke.json`:

| Instrument | Pages | Daily / hourly rows | Usable with limits | Quarantined |
| --- | ---: | ---: | ---: | ---: |
| ROSN | 31 | 847 / 13,365 | 846 | 1 |
| IMOEX | 19 | 724 / 7,215 | 713 | 11 |

ROSN 10 April 2025 disagrees in Low/Close/Volume. IMOEX discrepancies include
27/29/30 January 2025, 24 July, 1 September, 17 October; 16 February, 11 June,
16 September, 5/12 October 2026. These are genuine daily/hourly conflicts, not reasons
to silently select one response. The source-policy must preserve/quarantine them.
Consequently a whole-window backtest or an indicator window containing a conflict is
not certified by the success of the smaller 176-period probe. Required windows and
benchmark coverage must be checked independently in acceptance. No one has established
that the latest full history is universally usable.

`sourceRevision` values in the live metrics identify that exact captured dataset.
The two calls completed without HTTP/rate errors; that is an observation, not a promise
of future availability. No paid model calls were made by these probes. End-to-end runs,
DB migration preservation and user-visible acceptance are tracked separately in
`docs/market-data/acceptance.json`.

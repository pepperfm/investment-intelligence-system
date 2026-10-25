# MOEX calendar and two bar clocks

## Dates are different dimensions

A physical Moscow `sessionDate` identifies when prices occurred. A logical
`tradingDate` groups exchange sessions for the next regular trading day.
[MOEX stock-session technology](https://www.moex.com/a8920) and the
[2026 weekend announcement](https://www.moex.com/n95564) assign additional sessions
to that next day, with eligible weekend stock sessions 09:50–19:00 Moscow.
Instrument/board admission must be established separately. A ticker name or general
weekend schedule does not establish historical advance eligibility.

For 25–29 September 2026:

| Physical date | Logical day | Observed equity physical session |
| --- | --- | --- |
| Friday 25 | 25 September | separate period |
| Saturday 26 | 28 September | separate period |
| Sunday 27 | 28 September | separate period |
| Monday 28 | 28 September | separate period |
| Tuesday 29 | 29 September | separate period |

The real daily/hourly/history reconciliation proves this distinction; details and
source fixtures are in [market-data-contract.md](market-data-contract.md).
A Monday logical history bar contains both weekend volumes. A physical Monday daily
bar independently matches only Monday hourly observations. They must not share one axis.

## Legacy logical clock

`calendar.ts` compatibility helpers operate on UTC-midnight **date labels**, not
physical instants. `isTradingDay`, `addTradingDays`, `tradingDaysBetween` count a
regular logical day once. `moscowDate` / `inspectSession` inspect physical dates.
Ten logical days after 25 September 2026 is 9 October; that says nothing about a
physical-session horizon that counts 26/27 September separately.

Bundled logical schedule `moex-stocks-2026-v2` includes the
[holiday publication](https://www.moex.com/n96571) and
[4 September amendment](https://www.moex.com/n103931): 28–29 November closed instead
of 5–6 December. `asOf` before that amendment selects v1. 24–25 October are closed;
23 February, 1 May, 12 June, 4 November use additional sessions. The old unverified
years/boards remain unknown in this legacy helper. `mock-weekday-v1` is explicitly
synthetic and does not attest real exchange sessions.

The code intentionally does not infer a universal weekday stock opening from this
market-wide schedule: morning/evening admission varies. Historical observation also
does not establish when IIS first knew a future schedule. Old logical scenarios are
not silently converted into physical-session strategies.

## Physical-session research clock

`physical-session-facts-v1` and `physical_session_v1` count **confirmed physical
observations** for the scoped instrument/board. Source reconciliation can establish
2024, 2025 or 2026 facts without making the calendar pretend they were known live.
It has no hard-coded year gate. It is built from dated facts, source revisions,
observation times and bounded complete-response coverage.

An observed period establishes actual activity, not a closure on all missing dates.
No row stays `unknown`; coverage bounds counting but is not a blanket future schedule.
Weekend eligibility is not inferred from the weekday of a date. Conflicting duplicated
facts and missing required coverage preserve an explicit diagnostic.

Staleness counts confirmed sessions in the declared clock. Horizon labels use
“N confirmed sessions,” not legacy “N trading days.” An exact future `checkAt` needs
published instrument-scoped open/closed scheduling facts for the intervening dates.
Without those facts it is conditional/unknown; no guessed future date is advertised.
A future session may enter the clock only via a schedule genuinely available at the
cutoff, never through a later-observed price bar.

Research bars currently use a conservative `finalization_buffer` of two days after
physical-date midnight. This is an eligibility time, not the claimed actual exchange
close. The clock retains this distinction. Later-retrieved prices require explicit
historical reconstruction; they do not make later reports/news available in the past.

## Verification and retained limits

```sh
bun scripts/calendar-smoke.ts --live --record
bun scripts/market-contract-probe.ts --live --record
bun scripts/moex-series-smoke.ts --live --record
bun run test tests/calendar.test.ts tests/market-probe-fixtures.test.ts
```

The initial three-symbol fixture and original 2026 schedule evidence are retained.
New six-symbol probes capture public market fields, hashes and observation times;
no account identifiers, JWTs, credentials or private responses are saved.
MOEX daily/hourly equity prices match in the checked slices across 2024–2026.
Full-window ROSN/IMOEX smoke also finds real conflicting periods, retained as quarantine.
Per-period trust does not mean every period of the repository passes.

Finam D-bar completion/aggregation remains unproven and blocked. Selecting MOEX
research is an explicit configuration/source-policy choice while the broker remains
Finam. No old raw candles, hypotheses or snapshots are rewritten by these probes.
See [market-data-contract.md](market-data-contract.md) for all empirical conclusions,
limits and the exact algorithm.

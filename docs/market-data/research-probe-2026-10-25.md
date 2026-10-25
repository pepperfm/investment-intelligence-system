# Research and paper source discovery — 25 October 2026

This report adds evidence to the prior acceptance; it does not overwrite it.
It records deterministic candidate selection and quote-source readiness only.
The orchestrator's separate end-to-end report supplies actual run IDs and agent outcomes.

## Real positive screen

Command:

```sh
bun scripts/research-setup-scan.ts --read-only --record
```

The script opens a local PostgreSQL **read-only transaction**, reads existing immutable
MOEX audits and normalized rows, verifies matching normalized hashes and the source-policy
version, and reads the unchanged active strategy rules. For each date it selects the exact
last required eligible assessments, including quarantines; it never drops a damaged period
and replaces it with an older good candle. No rules, strategies, market rows or hypotheses
are inserted or changed. No AI is invoked.

The search inspected 1,256 windows and retained at most three newest positive cases per
symbol/strategy, 36 cases total. This bounded selection demonstrates routing, not strategy
profitability, a new independent holdout or a calibrated success probability.

**Fresh candidate: TATN / TQBR / Swing v1**, 210 reconciled physical observations through
23 October 2026, `regimeSma=0`, `setup=true` (pullback), no instrument-window quality issues.
The simultaneously selected IMOEX window has five real quarantined periods, including
12 October. It is unsuitable for optional comparisons and cannot supply relative metrics.

- Instrument ID: `42c7a310-5ab4-462e-a4fd-a50d1c92b3b8`.
- Strategy version: `58fa53ba-9312-4845-8945-951f75e55f8e`.
- Instrument audit: `22c89b4f-0e23-470e-806a-363556df8ce8`.
- Source revision: `aa5ccb0710ca0bf7dd02e2671be0a66b211b6205a7e40d33b0db2bd863da336c`.
- Selected assessment hash: `ef159592163de3cf70fcfecad6edb40fe72b70d3219ca7afeb10349e6a0d43fc`.
- Benchmark audit: `ca67d227-c06b-40db-b407-0a90fa5e4430`.

Close 632.4, SMA50 629.636, RSI14 49.26257, ATR14 16.05512 and average turnover
approximately 1.544 billion RUB satisfy the original Swing screen. Source-native
adjustments and historical availability remain unknown; these are reconstructed
market observations, not `verified` live execution evidence.

Machine-readable discovery is `research-setup-discovery-2026-10-25.json`.
The actual frozen 210-bar example is
`../../tests/fixtures/calendar/research-positive-tatn-2026-10-25.json`
(relative to this document: use repository `tests/fixtures/calendar/`).
Temporary detailed search output/log are `tmp/research-positive-setup-scan.json` and
`tmp/research-positive-setup-scan.log`. SHA of rules uses the application's order-stable
`rulesHash()` function, not an alternative hash convention.

## Observed execution source remains unready

Configured Finam MCP `get_quote` was actually queried for TATN and SBER; the direct
read-only Finam quote endpoint and public MOEX marketdata were then probed independently:

```sh
bun scripts/paper-execution-probe.ts --live --record
```

Actual observation: 25 October 2026 around 20:18 UTC, during the published no-trading
weekend. Both REST services returned HTTP 200, yet Finam timestamps were 23 October
20:49 UTC and only Last was present. Bid/ask were absent. MOEX had null BID/OFFER,
`TRADINGSTATUS=N`, and SYSTIME `2026-10-23 23:50:41`. Request round trips were about
1,042 ms for Finam and 31–195 ms for MOEX. These measure request latency only; they do
not establish feed delay or quote validity. Finam MCP's `is_delayed=false` does not
make a two-day-old quote fresh.

Status: **`not_ready_for_paper_execution`**. No order, confirmation, fill or cash/position
change was performed by any discovery/probe script. A last price is indicative, not a
market-fill promise. MOEX research reconstruction cannot authorize a fill.

Detailed public observations, timestamps and hashes:

- `paper-execution-probe-2026-10-25.json` (Finam REST + MOEX).
- `paper-execution-mcp-2026-10-25.json` (configured Finam MCP).

Further evidence requires repeated active-session bid/ask observations with explicit
source time, board/session, freshness and latency bounds, and an independently tested
versioned observed-quote execution model. This weekend probe cannot establish those facts.
Until then, data uncertainty must preserve `suspended_data_quality` and require explicit
reconfirmation after restoration. No live trading is introduced.

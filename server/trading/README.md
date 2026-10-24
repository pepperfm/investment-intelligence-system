# Trading gateway

- `paper-broker.ts` — the only order executor. Two-step flow: `createOrder` (server-side risk check,
  status `pending_confirmation`) → explicit UI confirmation `confirmOrder` (risk re-validated) → simulated fill.
- Idempotency: every order carries a client `idempotency_key` (unique); repeats return the existing order.
- Live trading is **not implemented on purpose**. A future `finam-trade-broker.ts` must run as a separate
  process with its own trade-write secret, never readable by agent processes, and reconcile order state with
  Finam before any retry (unknown outcomes after timeouts).
- AI agents have no import path, tool or endpoint that reaches this module.

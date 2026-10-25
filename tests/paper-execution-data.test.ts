import { describe, expect, it } from 'vitest'
import { inspectPaperExecutionMarketData, paperExecutionReadiness, type PaperExecutionMarketData } from '../server/domain/risk/paper-execution-data'

// Synthetic validation fixture, never proof of a real observed quote or source contract.
const scope = {
  instrumentId: 'fixture-instrument',
  board: 'TQBR',
  createdAt: new Date('2026-10-23T10:00:00Z'),
  confirmedAt: new Date('2026-10-23T10:01:00Z'),
  now: new Date('2026-10-23T10:01:12Z'),
}
const quote: PaperExecutionMarketData = {
  kind: 'observed_quote',
  source: 'finam',
  contractVersion: 'unaccepted-test-fixture',
  executionModelVersion: 'observed_quote_v1',
  instrumentId: scope.instrumentId,
  board: scope.board,
  bid: 100,
  ask: 101,
  observedAt: '2026-10-23T10:01:10Z',
  availableAt: '2026-10-23T10:01:11Z',
  maxAgeMs: 5_000,
  session: {
    id: 'fixture-session',
    status: 'open',
    confirmedAt: '2026-10-23T10:01:09Z',
    availableAt: '2026-10-23T10:01:10Z',
  },
}

describe('observed paper execution contract', () => {
  it('fails closed without an observed quote', () => {
    expect(inspectPaperExecutionMarketData(null, scope)).toMatchObject({
      ready: false,
      status: 'not_ready_for_paper_execution',
    })
  })
  it('a plausible quote does not independently certify its own source or grant execution', () => {
    const result = inspectPaperExecutionMarketData(quote, scope)
    expect(result.ready).toBe(false)
    expect(result.issues).toContain('not_ready_for_paper_execution:no_independently_validated_timely_observed_quote_contract')
  })
  it.each([
    [{ observedAt: '2026-10-23T10:00:59Z' }, 'execution_quote_not_observed_after_confirmation'],
    [{
      observedAt: '2026-10-23T10:01:20Z',
      availableAt: '2026-10-23T10:01:21Z',
    }, 'execution_quote_not_available_now'],
    [{ maxAgeMs: 1_000 }, 'execution_quote_stale_or_age_policy_unverified'],
    [{ maxAgeMs: 100_000 }, 'execution_quote_stale_or_age_policy_unverified'],
    [{ bid: 102 }, 'missing_or_invalid_observed_bid_ask'],
    [{ bid: null }, 'missing_or_invalid_observed_bid_ask'],
    [{ board: 'OTHER' }, 'execution_instrument_board_mismatch'],
    [{
      session: {
        ...quote.session,
        status: 'closed' as const,
      },
    }, 'execution_session_unconfirmed'],
  ])('rejects missing timing, session and price requirements (%o)', (changes, issue) => {
    expect(inspectPaperExecutionMarketData({
      ...quote,
      ...changes,
    }, scope).issues).toContain(issue)
  })
  it('daily bars and historical reconstructions cannot be promoted to an observed execution source', () => {
    for (const source of ['finam', 'moex_iss', 'unknown']) {
      expect(paperExecutionReadiness(source)).toMatchObject({
        ready: false,
        syntheticReplayAllowed: false,
        status: 'not_ready_for_paper_execution',
      })
    }
  })
  it('mock replay is explicitly synthetic and never claims observed market readiness', () => {
    expect(paperExecutionReadiness('mock')).toMatchObject({
      ready: false,
      syntheticReplayAllowed: true,
      status: 'mock_replay_only',
      executionModel: 'mock_daily_replay_v1',
    })
  })
})

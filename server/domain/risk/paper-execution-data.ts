/** Execution evidence is independent from research bars and historical reconstruction. */
export interface PaperExecutionMarketData {
  kind: 'observed_quote'
  source: 'finam' | 'moex_iss'
  contractVersion: string
  executionModelVersion: 'observed_quote_v1'
  instrumentId: string
  board: string
  bid: number | null
  ask: number | null
  observedAt: string
  availableAt: string
  maxAgeMs: number
  session: {
    id: string
    status: 'open' | 'closed' | 'unknown'
    confirmedAt: string
    availableAt: string
  }
}

export interface PaperExecutionScope {
  instrumentId: string
  board: string
  createdAt: Date
  confirmedAt: Date
  now: Date
}

const MAX_OBSERVATION_AGE_MS = 30_000

/** No observed-quote provider/model has passed independent acceptance yet. */
export function paperExecutionReadiness(source: string) {
  const mock = source === 'mock'
  return {
    status: mock ? 'mock_replay_only' as const : 'not_ready_for_paper_execution' as const,
    ready: false as const,
    syntheticReplayAllowed: mock,
    executionModel: mock ? 'mock_daily_replay_v1' : 'observed_quote_v1',
    source,
    issues: mock
      ? ['synthetic_mock_replay_only:not_observed_market_execution']
      : ['not_ready_for_paper_execution:no_independently_validated_timely_observed_quote_contract', 'daily_ohlcv_is_indicative_only:not_execution_evidence'],
  }
}

/** Necessary timing/session/quote checks; well-shaped data alone cannot establish source trust. */
export function inspectPaperExecutionMarketData(data: PaperExecutionMarketData | null, scope: PaperExecutionScope) {
  const issues: string[] = []
  if (!data) {
    issues.push('missing_observed_execution_quote')
  } else {
    const observed = Date.parse(data.observedAt)
    const available = Date.parse(data.availableAt)
    const sessionObserved = Date.parse(data.session.confirmedAt)
    const sessionAvailable = Date.parse(data.session.availableAt)
    if (data.kind !== 'observed_quote' || data.executionModelVersion !== 'observed_quote_v1') {
      issues.push('execution_model_mismatch')
    }
    if (!data.contractVersion) {
      issues.push('missing_execution_contract_version')
    }
    if (data.instrumentId !== scope.instrumentId || data.board !== scope.board) {
      issues.push('execution_instrument_board_mismatch')
    }
    if (![observed, available, sessionObserved, sessionAvailable, scope.now.getTime(), scope.createdAt.getTime(), scope.confirmedAt.getTime()].every(Number.isFinite)) {
      issues.push('invalid_execution_timestamps')
    }
    if (observed <= scope.createdAt.getTime() || observed <= scope.confirmedAt.getTime()) {
      issues.push('execution_quote_not_observed_after_confirmation')
    }
    if (available < observed || available > scope.now.getTime() || observed > scope.now.getTime()) {
      issues.push('execution_quote_not_available_now')
    }
    if (!Number.isFinite(data.maxAgeMs) || data.maxAgeMs <= 0 || data.maxAgeMs > MAX_OBSERVATION_AGE_MS
      || scope.now.getTime() - observed > Math.min(data.maxAgeMs, MAX_OBSERVATION_AGE_MS)) {
      issues.push('execution_quote_stale_or_age_policy_unverified')
    }
    if (data.bid === null || data.ask === null || !Number.isFinite(data.bid) || !Number.isFinite(data.ask)
      || data.bid <= 0 || data.ask <= 0 || data.bid > data.ask) {
      issues.push('missing_or_invalid_observed_bid_ask')
    }
    if (!data.session.id || data.session.status !== 'open' || sessionObserved > observed
      || sessionAvailable < sessionObserved || sessionAvailable > available) {
      issues.push('execution_session_unconfirmed')
    }
  }
  // A caller cannot certify a source by supplying `verified: true` or a plausible quote object.
  issues.push('not_ready_for_paper_execution:no_independently_validated_timely_observed_quote_contract')
  return {
    status: 'not_ready_for_paper_execution' as const,
    ready: false as const,
    executionModel: 'observed_quote_v1',
    issues,
  }
}

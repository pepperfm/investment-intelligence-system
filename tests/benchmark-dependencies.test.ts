import { describe, expect, it } from 'vitest'
import { benchmarkNeed, signalDependencies } from '../server/domain/market/dependencies'
import { DEFAULT_RULES } from '../server/domain/strategies/rules'

const bar = {
  ts: '2026-10-23T00:00:00Z',
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 20,
  barPolicyId: 'physical_session_v1',
}
const good = {
  bars: [bar],
  quality: {
    status: 'research_usable_with_limits' as const,
    issues: ['historical_availability_unknown'],
  },
}
const bad = {
  bars: [],
  quality: {
    status: 'data_quality_blocked' as const,
    issues: ['daily_intraday_mismatch:high'],
  },
}
describe('mandatory and optional signal dependencies', () => {
  it('does not block a good stock on optional broken IMOEX', () => {
    expect(benchmarkNeed({
      ...DEFAULT_RULES.swing,
      regimeSma: 0,
    })).toBe('optional_for_context')
    const result = signalDependencies({
      rules: {
        ...DEFAULT_RULES.swing,
        regimeSma: 0,
      },
      instrument: good,
      benchmark: bad,
    })
    expect(result.signalEligibility).toEqual({
      status: 'eligible',
      issues: [],
    })
    expect(result.benchmarkUnavailableReason).toContain('daily_intraday_mismatch')
    expect(result.contextLimitations.length).toBeGreaterThan(0)
  })
  it('requires IMOEX only for enabled rules and never covers broken stock with a good index', () => {
    expect(benchmarkNeed({
      ...DEFAULT_RULES.swing,
      regimeSma: 50,
    })).toBe('required_for_signal')
    expect(signalDependencies({
      rules: {
        ...DEFAULT_RULES.swing,
        regimeSma: 50,
      },
      instrument: good,
      benchmark: bad,
    }).signalEligibility.status).toBe('blocked')
    expect(signalDependencies({
      rules: DEFAULT_RULES.swing,
      instrument: bad,
      benchmark: good,
    }).signalEligibility.status).toBe('blocked')
  })
  it('does not use older or different-policy index bars as a current regime observation', () => {
    const shifted = {
      ...good,
      bars: [{
        ...bar,
        ts: '2026-10-22T00:00:00Z',
      }],
    }
    const mixed = {
      ...good,
      bars: [{
        ...bar,
        barPolicyId: 'logical_trading_day_v1',
      }],
    }
    for (const benchmark of [shifted, mixed]) {
      expect(signalDependencies({
        rules: {
          ...DEFAULT_RULES.swing,
          regimeSma: 1,
        },
        instrument: good,
        benchmark,
      }).signalEligibility.status).toBe('blocked')
    }
  })
})

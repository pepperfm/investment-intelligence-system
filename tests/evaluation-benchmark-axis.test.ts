import { describe, expect, it } from 'vitest'
import { benchmarkWindowIssues, signalDependencies } from '../server/domain/market/dependencies'
import { DEFAULT_RULES, evaluateSignal } from '../server/domain/strategies/rules'
import type { Candle } from '../shared/types/investment'

const bars: Candle[] = Array.from({ length: 210 }, (_, day) => ({
  ts: new Date(Date.UTC(2024, 0, 2 + day)).toISOString(),
  open: 100 + day,
  high: 102 + day,
  low: 99 + day,
  close: 101 + day,
  volume: 1e8,
  barPolicyId: 'physical_session_v1',
  normalizationVersion: 'test-physical-v1',
  dataSource: 'moex_iss',
  physicalSessionDate: new Date(Date.UTC(2024, 0, 2 + day)).toISOString().slice(0, 10),
}))
const quality = {
  status: 'research_usable_with_limits' as const,
  issues: [],
}
const requiredRules = {
  ...DEFAULT_RULES.swing,
  regimeSma: 50,
}

describe('one required benchmark window contract', () => {
  it('does not replace an interior missing benchmark session with an older observation', () => {
    const missing = bars.filter((_bar, i) => i !== 190)
    expect(missing.length).toBeGreaterThan(requiredRules.regimeSma)
    expect(benchmarkWindowIssues(bars, missing, 50)).toEqual(['benchmark_incomplete_regime_axis:49/50'])
    const dependencies = signalDependencies({
      rules: requiredRules,
      instrument: {
        bars,
        quality,
      },
      benchmark: {
        bars: missing,
        quality,
      },
    })
    expect(dependencies.signalEligibility.status).toBe('blocked')
    expect(evaluateSignal('swing', requiredRules, bars, missing).failures.join(' ')).toMatch(/benchmark_incomplete_regime_axis/)
  })
  it('matches every required session and policy, independently of weekday or year', () => {
    expect(benchmarkWindowIssues(bars, bars, 50)).toEqual([])
    const policyMismatch = bars.map(bar => ({
      ...bar,
      barPolicyId: 'logical_trading_day_v1',
    }))
    expect(benchmarkWindowIssues(bars, policyMismatch, 50)).toEqual(['benchmark_regime_policy_not_comparable'])
    const duplicate = [...bars.slice(0, 190), bars[189]!, ...bars.slice(190)]
    expect(benchmarkWindowIssues(bars, duplicate, 50)[0]).toMatch(/benchmark_incomplete_regime_axis/)
  })
  it('does not make an optional index into a mandatory signal window', () => {
    const optionalRules = {
      ...requiredRules,
      regimeSma: 0,
    }
    const dependencies = signalDependencies({
      rules: optionalRules,
      instrument: {
        bars,
        quality,
      },
      benchmark: null,
    })
    expect(dependencies.signalEligibility.status).toBe('eligible')
    expect(evaluateSignal('swing', optionalRules, bars, []).failures.join(' ')).not.toMatch(/индекса/)
    expect(evaluateSignal('swing', requiredRules, bars, []).failures.join(' ')).toMatch(/индекса/)
  })
})

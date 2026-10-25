import { describe, expect, it } from 'vitest'
import { evaluateScenarioDecision } from '../server/domain/evaluations/outcome'
import { evaluationHash } from '../server/domain/evaluations/backtest'
import type { Candle } from '../shared/types/investment'

const input = {
  future: [{
    ts: '2026-09-28T20:59:59Z',
    open: 100,
    high: 112,
    low: 99,
    close: 110,
  }] satisfies Candle[],
  benchmarkFuture: [] as Candle[],
  entry: {
    type: 'market_next_open' as const,
    price: 100,
    validDays: 1,
    note: '',
  },
  exit: {
    stopLoss: 95,
    takeProfit: 110,
    timeExitDays: 3,
    note: '',
  },
  costs: {
    commissionPct: 0.05,
    spreadPct: 0.05,
    slippagePct: 0.1,
  },
  recommendation: 'no_trade' as const,
  evidenceQuality: {
    validationOk: true,
    decisionVerdict: 'supported',
    semantics: 'explicit' as const,
  },
}

describe('scenario and decision evaluation remain independent', () => {
  it('a profitable alternative is missed gain, never an overturned no-trade decision', () => {
    const result = evaluateScenarioDecision(input)
    expect(result.status).toBe('evaluated')
    expect(result.scenarioEvaluation.isCounterfactual).toBe(true)
    expect(result.decisionEvaluation.missedGain).toBeCloseTo(0.0965)
    expect(result.decisionEvaluation.avoidedLoss).toBe(0)
    expect(result.decisionEvaluation.evidenceQuality.decisionVerdict).toBe('supported')
    expect(result.decisionEvaluation).not.toHaveProperty('correct')
    expect(result.scenarioEvaluation.benchmarkReturn).toBeNull()
  })
  it('an unprofitable alternative is avoided loss, without manufacturing a price forecast', () => {
    const result = evaluateScenarioDecision({
      ...input,
      future: [{
        ...input.future[0]!,
        high: 102,
        low: 94,
        close: 96,
      }],
    })
    expect(result.decisionEvaluation.avoidedLoss).toBeCloseTo(0.0535)
    expect(result.decisionEvaluation.missedGain).toBe(0)
    expect(result).not.toHaveProperty('forecastEvaluation')
  })
  it.each([
    ['missing_future_data', { future: [] }],
    ['ambiguous_session', { qualityIssues: ['Finam daily contract unverified'] }],
    ['incomplete_horizon', {
      future: [{
        ...input.future[0]!,
        high: 101,
        low: 99,
        close: 100,
      }],
    }],
    ['not_entered', {
      entry: {
        ...input.entry,
        type: 'limit' as const,
        price: 80,
      },
    }],
  ])('reports %s instead of zero returns', (status, changes) => {
    const result = evaluateScenarioDecision({
      ...input,
      ...changes,
    })
    expect(result.status).toBe(status)
    expect(result.scenarioEvaluation.netReturn).toBeNull()
    expect(result.decisionEvaluation.avoidedLoss).toBeNull()
    expect(result.decisionEvaluation.missedGain).toBeNull()
  })
  it('long scenarios remain counterfactual even if a user approved the hypothesis', () => {
    const result = evaluateScenarioDecision({
      ...input,
      recommendation: 'long',
    })
    expect(result.scenarioEvaluation.isCounterfactual).toBe(true)
    expect(result.decisionEvaluation.avoidedLoss).toBeNull()
  })
})

describe('audit input hashes', () => {
  it('ignores object-key ordering but detects rule, cost and future-series changes', () => {
    expect(evaluationHash({
      a: 1,
      b: 2,
    })).toBe(evaluationHash({
      b: 2,
      a: 1,
    }))
    expect(evaluationHash(input)).not.toBe(evaluationHash({
      ...input,
      costs: {
        ...input.costs,
        commissionPct: 0.1,
      },
    }))
    expect(evaluationHash(input)).not.toBe(evaluationHash({
      ...input,
      future: [{
        ...input.future[0]!,
        close: 109,
      }],
    }))
  })
})

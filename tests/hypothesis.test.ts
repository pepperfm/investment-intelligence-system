import { describe, expect, it } from 'vitest'
import { gateStatus, nextStatusForDecision } from '../server/domain/hypotheses/state'
import { validateHypothesis } from '../server/domain/hypotheses/validation'
import type { AnalystOutput } from '../shared/schemas/investment'

describe('critic hard gate', () => {
  it('never reaches the user without a successful critic', () => {
    expect(gateStatus({
      criticVerdict: null,
      criticSucceeded: false,
      validationOk: true,
    })).toBe('awaiting_critic')
  })
  it('disputed or insufficient evidence requires review, never averaging', () => {
    expect(gateStatus({
      criticVerdict: 'disputed',
      criticSucceeded: true,
      validationOk: true,
    })).toBe('needs_review')
    expect(gateStatus({
      criticVerdict: 'insufficient_evidence',
      criticSucceeded: true,
      validationOk: true,
    })).toBe('needs_review')
  })
  it('supported but failing code validation still needs review', () => {
    expect(gateStatus({
      criticVerdict: 'supported',
      criticSucceeded: true,
      validationOk: false,
    })).toBe('needs_review')
    expect(gateStatus({
      criticVerdict: 'supported',
      criticSucceeded: true,
      validationOk: true,
    })).toBe('ready_for_user')
  })
})

describe('user decisions', () => {
  it('cannot approve before the critic or when disputed', () => {
    expect(() => nextStatusForDecision('awaiting_critic', 'approve')).toThrow()
    expect(() => nextStatusForDecision('needs_review', 'approve')).toThrow()
    expect(nextStatusForDecision('needs_review', 'reject')).toBe('user_rejected')
    expect(nextStatusForDecision('ready_for_user', 'approve')).toBe('user_approved')
  })
})

const draft: AnalystOutput = {
  direction: 'long',
  thesis: 'Тезис',
  supportingEvidence: [{
    claim: 'тренд',
    sourceIds: ['metrics'],
  }],
  counterEvidence: [{
    claim: 'риск',
    sourceIds: ['ev:unknown'],
  }],
  assumptions: [],
  invalidationConditions: ['стоп'],
  riskNotes: [],
  alternatives: [],
  confidence: 0.5,
  entryNote: '',
  exitNote: '',
}

describe('validateHypothesis', () => {
  const sources = [{
    id: 'metrics',
    kind: 'metrics' as const,
    title: 'm',
    url: null,
    asOf: '2026-10-23T00:00:00.000Z',
  }]
  it('flags unknown sources, inconsistent levels and stale data', () => {
    const result = validateHypothesis({
      draft,
      entry: {
        type: 'market_next_open',
        price: 100,
        validDays: 1,
        note: '',
      },
      exit: {
        stopLoss: 105,
        takeProfit: 110,
        timeExitDays: 10,
        note: '',
      },
      sources,
      lastCandleTs: '2026-10-01T00:00:00.000Z',
      asOf: new Date('2026-10-24T00:00:00.000Z'),
      maxStaleDays: 5,
      rewardRisk: 2,
      minRewardRisk: 1.2,
    })
    expect(result.ok).toBe(false)
    expect(result.issues.join(' ')).toMatch(/несуществующие/)
    expect(result.issues.join(' ')).toMatch(/стоп < вход < цель/)
    expect(result.issues.join(' ')).toMatch(/устарели/)
  })
})

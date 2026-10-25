import { describe, expect, it } from 'vitest'
import { analystOutputSchema, criticOutputSchema, researchOutputSchema } from '../shared/schemas/investment'
import { strictJsonSchema } from '../server/ai/contracts'
import { validateCriticOutput, validateHypothesis } from '../server/domain/hypotheses/validation'

const asOf = new Date('2026-09-25T20:59:59Z')
const sources = [{
  id: 'metrics',
  kind: 'metrics' as const,
  title: 'Проверяемые метрики',
  url: null,
  asOf: asOf.toISOString(),
}]
const gap = {
  sourceKey: 'cbr_daily' as const,
  status: 'not_yet_observed' as const,
  reason: 'История получена только в октябре',
  impact: 'Макро не подтверждено на дату',
  asOf: asOf.toISOString(),
}
const decision = {
  recommendation: 'no_trade' as const,
  decisionThesis: 'Покупка не обоснована доступными свидетельствами',
  decisionBasis: ['missing_material_evidence' as const],
  decisionConfidence: 0.56,
  priceForecast: null,
  coverageGaps: [gap],
  direction: 'no_trade' as const,
  thesis: 'Покупка не обоснована доступными свидетельствами',
  confidence: 0.56,
  supportingEvidence: [{
    claim: 'Историческое преимущество не показано метриками',
    sourceIds: ['metrics'],
  }],
  counterEvidence: [{
    claim: 'Технический условный сценарий положителен',
    sourceIds: ['metrics'],
  }],
  assumptions: [],
  invalidationConditions: ['Новые доступные доказательства'],
  riskNotes: [],
  alternatives: [],
  entryNote: '',
  exitNote: '',
}
const critic = {
  verdictTarget: 'decision' as const,
  decisionVerdict: 'supported' as const,
  verdict: 'supported' as const,
  forecastVerdict: 'not_applicable' as const,
  summary: 'Отказ обоснован, направление цены не установлено',
  findings: [],
  missingChecks: [],
  coverageGaps: [gap],
}
const validationInput = {
  draft: decision,
  sources,
  asOf,
  entry: {
    type: 'market_next_open' as const,
    price: 100,
    validDays: 2,
    note: '',
  },
  exit: {
    stopLoss: 95,
    takeProfit: 110,
    timeExitDays: 10,
    note: '',
  },
  lastCandleTs: asOf.toISOString(),
  maxStaleDays: 5,
  rewardRisk: 2,
  minRewardRisk: 1.2,
}

describe('decision and measurable forecast are distinct', () => {
  it('ROSN: supports refusing a positive conditional scenario without claiming TP failure', () => {
    expect(analystOutputSchema.parse(decision).priceForecast).toBeNull()
    expect(validateHypothesis(validationInput).ok).toBe(true)
    expect(validateCriticOutput(critic, sources, asOf).ok).toBe(true)
    expect(critic.forecastVerdict).toBe('not_applicable')
  })
  it('NVTK: refusal can be supported while a separately stated price forecast is unproven', () => {
    const forecast = {
      criterion: 'stop_before_take_profit' as const,
      windowTradingDays: 10,
      rationale: 'Отдельный прогноз исхода условного сценария',
      sourceIds: ['metrics'],
    }
    const output = analystOutputSchema.parse({
      ...decision,
      priceForecast: forecast,
    })
    const review = {
      ...critic,
      forecastVerdict: 'insufficient_evidence' as const,
    }
    expect(validateCriticOutput(review, sources, asOf, output.priceForecast).ok).toBe(true)
    expect(review.decisionVerdict).toBe('supported')
    expect(review.forecastVerdict).toBe('insufficient_evidence')
    expect(validateCriticOutput(critic, sources, asOf, forecast).ok).toBe(false)
  })
  it('rejects ambiguous legacy aliases and unmeasurable forecast objects', () => {
    expect(analystOutputSchema.safeParse({
      ...decision,
      direction: 'long',
    }).success).toBe(false)
    expect(analystOutputSchema.safeParse({
      ...decision,
      thesis: 'Цена точно вырастет',
    }).success).toBe(false)
    expect(analystOutputSchema.safeParse({
      ...decision,
      priceForecast: { text: 'Цена вырастет' },
    }).success).toBe(false)
    expect(criticOutputSchema.safeParse({
      ...critic,
      verdict: 'disputed',
    }).success).toBe(false)
    expect(analystOutputSchema.safeParse({
      direction: 'no_trade',
      thesis: 'Old ambiguous output',
    }).success).toBe(false)
  })
  it('requires forecast citations and the frozen measurable window', () => {
    const forecast = {
      criterion: 'positive_net_return' as const,
      windowTradingDays: 11,
      rationale: 'Прогноз',
      sourceIds: ['invented'],
    }
    const result = validateHypothesis({
      ...validationInput,
      draft: {
        ...decision,
        priceForecast: forecast,
      },
    })
    expect(result.issues.join(' ')).toMatch(/несуществующие/)
    expect(result.issues.join(' ')).toMatch(/Окно прогноза/)
  })
})

describe('coverage is not a citation', () => {
  it('accepts the structured historical gap but rejects the same sourceKey as evidence id', () => {
    expect(validateHypothesis(validationInput).ok).toBe(true)
    const result = validateHypothesis({
      ...validationInput,
      draft: {
        ...decision,
        supportingEvidence: [{
          claim: 'Нет макро',
          sourceIds: ['cbr_daily'],
        }],
      },
    })
    expect(result.ok).toBe(false)
    expect(result.issues.join(' ')).toMatch(/несуществующие/)
    expect(analystOutputSchema.safeParse({
      ...decision,
      coverageGaps: [{
        ...gap,
        sourceKey: 'invented',
      }],
    }).success).toBe(false)
  })
  it('never accepts an unknown critic citation, malformed output, or forecast without target', () => {
    const result = validateCriticOutput({
      ...critic,
      findings: [{
        severity: 'warning',
        topic: 'Покрытие',
        detail: 'Нет данных',
        sourceIds: ['issuer_disclosure'],
      }],
    }, sources, asOf)
    expect(result.ok).toBe(false)
    expect(result.issues.join(' ')).toMatch(/несуществующий/)
    expect(validateCriticOutput({ verdict: 'supported' }, sources, asOf).ok).toBe(false)
    expect(validateCriticOutput({
      ...critic,
      forecastVerdict: 'supported',
    }, sources, asOf).ok).toBe(false)
  })
  it('checks gap date and rejects a future available evidence reference', () => {
    const futureGap = {
      ...gap,
      asOf: '2026-10-25T20:59:59Z',
    }
    expect(validateHypothesis({
      ...validationInput,
      draft: {
        ...decision,
        coverageGaps: [futureGap],
      },
    }).ok).toBe(false)
    const future = [{
      ...sources[0]!,
      availableAt: '2026-10-25T00:00:00Z',
    }]
    expect(validateCriticOutput(critic, future, asOf).ok).toBe(false)
    expect(validateHypothesis({
      ...validationInput,
      sources: future,
    }).ok).toBe(false)
  })
})

describe('strict structured agent JSON', () => {
  it('requires every nested property while representing absence by null', () => {
    const visit = (node: unknown) => {
      if (!node || typeof node !== 'object') {
        return
      }
      if (Array.isArray(node)) {
        node.forEach(visit)
        return
      }
      const object = node as Record<string, unknown>
      if (object.type === 'object') {
        expect(object.additionalProperties).toBe(false)
        expect(object.required).toEqual(Object.keys(object.properties as object))
      }
      Object.values(object).forEach(visit)
    }
    for (const schema of [analystOutputSchema, criticOutputSchema, researchOutputSchema]) {
      visit(strictJsonSchema(schema))
    }
    expect(analystOutputSchema.safeParse({
      ...decision,
      priceForecast: undefined,
    }).success).toBe(false)
  })
})

describe('explicit mixed no_trade thesis regression', () => {
  it.each([
    'После отката ROSN продолжит краткосрочный рост и достигнет цели раньше стопа. При этом покупать не оправдано.',
    'NVTK за десять торговых дней не достигнет цели раньше стопа; покупка не оправдана.',
  ])('requires price predictions to stay outside decisionThesis: %s', (thesis) => {
    expect(analystOutputSchema.safeParse({
      ...decision,
      decisionThesis: thesis,
      thesis,
    }).success).toBe(false)
  })
})

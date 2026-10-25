import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResearchBarSelection } from '../shared/types/market-data'
import { DEFAULT_RULES } from '../server/domain/strategies/rules'

import { backtestUniverse, trackRecord, futureEvaluationSelection } from '../server/services/evaluations'

const state = vi.hoisted(() => ({
  calls: [] as {
    instrumentId: string
    asOf: Date
    purpose: string
    selection: ResearchBarSelection
  }[],
  freezeCalls: [] as ResearchBarSelection[],
  unusable: new Set<string>(),
  limited: new Set<string>(),
}))
vi.mock('@nuxthub/db', async () => {
  const investment = await import('../server/db/schema/investment')
  return {
    schema: investment,
    db: {
      select: () => ({
        from: () => ({
          where: async () => [
            {
              id: 'ROSN',
              symbol: 'ROSN@MISX',
            }, {
              id: 'NVTK',
              symbol: 'NVTK@MISX',
            },
          ],
        }),
      }),
    },
  }
})
vi.mock('../server/services/market', () => ({
  freezeResearchSelection: async (selection: ResearchBarSelection) => {
    state.freezeCalls.push(selection)
    return {
      ...selection,
      auditIds: {
        ROSN: 'future-rosn-audit',
        NVTK: null,
        IMOEX: 'future-index-audit',
      },
    }
  },
  benchmarkInstrument: async () => ({
    id: 'IMOEX',
    symbol: 'IMOEX@MISX',
  }),
  researchBarSelection: () => ({
    provider: 'mock',
    policyId: 'mock_daily',
    revisionCutoff: '2026-10-25T00:00:00Z',
    inputSetVersion: 'mock-v1',
  }),
  loadResearchBars: async (options: {
    instrumentId: string
    asOf: Date
    purpose: string
    selection: ResearchBarSelection
  }) => {
    state.calls.push(options)
    const blocked = state.unusable.has(options.instrumentId)
    const limited = state.limited.has(options.instrumentId)
    const bars = blocked
      ? []
      : [{
          ts: '2024-01-05T00:00:00Z',
          open: 100,
          high: 110,
          low: 90,
          close: 105,
          volume: 1000,
        }]
    return {
      bars,
      quality: {
        status: blocked ? 'data_quality_blocked' : limited ? 'research_usable_with_limits' : 'verified',
        issues: blocked ? ['source_missing'] : limited ? ['source_adjustment_policy_unknown'] : [],
      },
      provenance: {
        source: options.selection.provider,
        selection: options.selection,
      },
      gaps: [],
    }
  },
  getInstrument: vi.fn(),
  loadCandles: vi.fn(),
}))
vi.mock('../server/services/memory', () => ({ upsertDocument: vi.fn() }))
vi.mock('../server/services/settings', () => ({
  getCostModel: async () => ({
    commissionPct: 0.03,
    spreadPct: 0.02,
    slippagePct: 0.01,
  }),
}))
vi.mock('../server/services/strategies', () => ({
  activeVersion: vi.fn(),
  proposeVersion: vi.fn(),
}))
const selection: ResearchBarSelection = {
  provider: 'moex_iss',
  policyId: 'physical_session_v1',
  revisionCutoff: '2026-10-24T12:00:00Z',
  inputSetVersion: 'physical-v1',
  auditIds: {
    ROSN: 'original-rosn-audit',
    NVTK: 'original-nvtk-audit',
    IMOEX: 'original-index-audit',
  },
}
const asOf = new Date('2024-01-10T12:00:00Z')

beforeEach(() => {
  state.calls = []
  state.freezeCalls = []
  state.unusable.clear()
  state.limited.clear()
})

describe('single source-pinned replay path', () => {
  it('pins all instrument and index loads to the identical source policy, cutoff and backtest purpose', async () => {
    const result = await backtestUniverse(asOf, selection)
    expect(state.calls).toHaveLength(3)
    expect(state.calls.every(call => call.purpose === 'backtest' && call.asOf === asOf && call.selection === selection)).toBe(true)
    expect(result.dataQuality.status).toBe('verified')
    expect(result.rawInput.selection).toEqual(selection)
  })
  it('keeps an available series when an unrelated instrument is blocked, disclosing the partial universe', async () => {
    state.unusable.add('NVTK')
    const result = await backtestUniverse(asOf, selection)
    expect(result.series.map(row => row.symbol)).toEqual(['ROSN@MISX'])
    expect(result.dataQuality.status).toBe('research_usable_with_limits')
    expect(result.dataQuality.excludedSymbols).toEqual(['NVTK@MISX'])
    expect(result.dataQuality.issues.join(' ')).toMatch(/partial_universe_excluded/)
  })
  it('retains exploratory reconstructed statistics but never promotes them to verified evidence', async () => {
    state.limited.add('ROSN')
    const result = await trackRecord('swing', 'rules-v1', DEFAULT_RULES.swing, asOf, {
      commissionPct: 0.02,
      spreadPct: 0.01,
      slippagePct: 0.01,
    }, selection)
    expect(result.dataQuality.status).toBe('research_usable_with_limits')
    expect(result.audit.dataQuality.statisticsMeaning).toMatch(/not verified/)
    expect(result.audit.rawInput.selection).toEqual(selection)
  })
  it('blocks numerical replay only when no eligible equity series exists', async () => {
    state.unusable.add('ROSN')
    state.unusable.add('NVTK')
    const result = await backtestUniverse(asOf, selection)
    expect(result.dataQuality.status).toBe('data_quality_blocked')
    expect(result.series).toEqual([])
  })
})

describe('evaluation future observations get fresh exact audit pins', () => {
  it('discards old snapshot audit IDs before freezing the new committed future revisions', async () => {
    const original: ResearchBarSelection = {
      ...selection,
      auditIds: {
        ROSN: 'original-rosn-audit',
        NVTK: 'original-nvtk-audit',
        IMOEX: 'original-index-audit',
      },
    }
    const computedAt = new Date('2026-10-25T19:00:00Z')
    const future = await futureEvaluationSelection(original, computedAt)
    expect(state.freezeCalls).toHaveLength(1)
    expect(state.freezeCalls[0]!.auditIds).toBeUndefined()
    expect(state.freezeCalls[0]!.revisionCutoff).toBe(computedAt.toISOString())
    expect(future.auditIds).toEqual({
      ROSN: 'future-rosn-audit',
      NVTK: null,
      IMOEX: 'future-index-audit',
    })
    expect(future.policyId).toBe(original.policyId)
    expect(future.provider).toBe(original.provider)
    expect(future.inputSetVersion).toBe(original.inputSetVersion)
    expect(original.auditIds!.ROSN).toBe('original-rosn-audit')
    expect(original.revisionCutoff).toBe(selection.revisionCutoff)
    await backtestUniverse(asOf, future)
    expect(state.calls.every(call => call.selection.auditIds === future.auditIds)).toBe(true)
  })
})

// Missing optional comparative data never invalidates verified absolute input history.
it('separates absolute input verification from a missing optional benchmark', async () => {
  state.unusable.add('IMOEX')
  const result = await backtestUniverse(new Date('2026-10-25T00:00:00Z'))
  expect(result.dataQuality.absoluteInputVerified).toBe(true)
  expect(result.dataQuality.benchmarkRelativeVerified).toBe(false)
  expect(result.dataQuality.status).toBe('research_usable_with_limits')
})

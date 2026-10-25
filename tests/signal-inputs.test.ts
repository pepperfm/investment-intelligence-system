import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResearchBarSelection } from '../shared/types/market-data'
import { DEFAULT_RULES } from '../server/domain/strategies/rules'
import { loadSignalInputs } from '../server/services/signal-inputs'

const state = vi.hoisted(() => ({
  calls: [] as {
    instrumentId: string
    limit: number
    asOf: Date
    purpose: string
    selection: ResearchBarSelection
  }[],
  brokenBenchmark: true,
  throwBenchmark: false,
  throwInstrument: false,
}))
vi.mock('../server/services/market', () => ({
  loadResearchBars: async (options: {
    instrumentId: string
    limit: number
    asOf: Date
    purpose: string
    selection: ResearchBarSelection
  }) => {
    state.calls.push(options)
    if ((options.instrumentId === 'IMOEX' && state.throwBenchmark) || (options.instrumentId !== 'IMOEX' && state.throwInstrument)) {
      throw new Error('source_read_failed')
    }
    // The stock is valid in its actual 210-session window, with an older conflict outside it.
    const blocked = options.instrumentId === 'IMOEX' ? state.brokenBenchmark : options.limit > 210
    const bars = blocked
      ? []
      : Array.from({ length: options.limit }, (_, i) => ({
          ts: new Date(Date.UTC(2024, 0, 1 + (210 - options.limit) + i)).toISOString(),
          open: 100,
          high: 110,
          low: 90,
          close: 100,
          volume: 1,
          barPolicyId: 'physical_session_v1',
          normalizationVersion: 'test-physical',
          dataSource: 'moex_iss',
        }))
    return {
      bars,
      quality: {
        status: blocked ? 'data_quality_blocked' : 'research_usable_with_limits',
        issues: blocked ? ['old_or_index_conflict'] : ['historical_reconstruction'],
      },
      provenance: { selection: options.selection },
      gaps: [],
    }
  },
}))
const selection: ResearchBarSelection = {
  provider: 'moex_iss',
  policyId: 'physical_session_v1',
  revisionCutoff: '2026-10-25T00:00:00Z',
  inputSetVersion: 'test-physical',
  auditIds: {
    ROSN: 'stock-audit',
    IMOEX: 'index-audit',
  },
}
const asOf = new Date('2024-07-30T20:59:59Z')
beforeEach(() => {
  state.calls = []
  state.brokenBenchmark = true
  state.throwBenchmark = false
  state.throwInstrument = false
})

describe('shared signal input scope', () => {
  it('uses the same required physical lookback for API/research and ignores older conflicts outside it', async () => {
    const result = await loadSignalInputs({
      instrumentId: 'ROSN',
      benchmarkId: 'IMOEX',
      rules: DEFAULT_RULES.swing,
      asOf,
      selection,
    })
    expect(state.calls.find(call => call.instrumentId === 'ROSN')!.limit).toBe(210)
    expect(state.calls.every(call => call.selection === selection && call.asOf === asOf && call.purpose === 'signal')).toBe(true)
    expect(result.research.quality.status).toBe('research_usable_with_limits')
    expect(result.dependencies.signalEligibility.status).toBe('eligible')
    expect(result.dependencies.benchmarkUnavailableReason).toMatch(/old_or_index_conflict/)
    expect(result.benchmarkCandles).toEqual([])
  })
  it('keeps a blocked required benchmark separate from a valid instrument', async () => {
    const result = await loadSignalInputs({
      instrumentId: 'ROSN',
      benchmarkId: 'IMOEX',
      rules: {
        ...DEFAULT_RULES.swing,
        regimeSma: 50,
      },
      asOf,
      selection,
    })
    expect(state.calls.find(call => call.instrumentId === 'IMOEX')!.limit).toBe(50)
    expect(result.research.quality.status).toBe('research_usable_with_limits')
    expect(result.dependencies.signalEligibility.status).toBe('blocked')
  })
  it('uses complete rule-specific instrument windows rather than reducing a requested larger lookback', async () => {
    const result = await loadSignalInputs({
      instrumentId: 'ROSN',
      benchmarkId: null,
      rules: {
        ...DEFAULT_RULES.swing,
        slowSma: 250,
      },
      asOf,
      selection,
    })
    expect(state.calls[0]!.limit).toBe(250)
    expect(result.dependencies.signalEligibility.status).toBe('blocked')
  })
  it('allows an exact complete required regime window and never needs a damaged longer optional window', async () => {
    state.brokenBenchmark = false
    const result = await loadSignalInputs({
      instrumentId: 'ROSN',
      benchmarkId: 'IMOEX',
      rules: {
        ...DEFAULT_RULES.swing,
        regimeSma: 50,
      },
      asOf,
      selection,
    })
    expect(result.dependencies.signalEligibility.status).toBe('eligible')
    expect(result.benchmarkCandles).toHaveLength(50)
  })
  it('catches only benchmark failures; instrument failures never trigger another source', async () => {
    state.throwBenchmark = true
    const result = await loadSignalInputs({
      instrumentId: 'ROSN',
      benchmarkId: 'IMOEX',
      rules: DEFAULT_RULES.swing,
      asOf,
      selection,
    })
    expect(result.benchmarkResearch).toBeNull()
    expect(result.dependencies.signalEligibility.status).toBe('eligible')
    state.throwInstrument = true
    await expect(loadSignalInputs({
      instrumentId: 'ROSN',
      benchmarkId: null,
      rules: DEFAULT_RULES.swing,
      asOf,
      selection,
    })).rejects.toThrow('source_read_failed')
    expect(state.calls.filter(call => call.instrumentId === 'ROSN')).toHaveLength(2)
  })
  it('preserves declared legacy lookback sizes instead of silently converting their clock', async () => {
    await loadSignalInputs({
      instrumentId: 'ROSN',
      benchmarkId: 'IMOEX',
      rules: DEFAULT_RULES.swing,
      asOf,
      selection: {
        ...selection,
        provider: 'mock',
        policyId: 'mock_daily',
      },
    })
    expect(state.calls.find(call => call.instrumentId === 'ROSN')!.limit).toBe(400)
    expect(state.calls.find(call => call.instrumentId === 'IMOEX')!.limit).toBe(300)
  })
})

import type { Candle, StrategyRules } from '../../../shared/types/investment'
import type { ResearchQuality } from '../../../shared/types/market-data'

export type BenchmarkNeed = 'required_for_signal' | 'optional_for_context'
export function benchmarkNeed(rules: StrategyRules): BenchmarkNeed {
  return (rules.regimeSma ?? 0) > 0 ? 'required_for_signal' : 'optional_for_context'
}
/** Require the same complete physical/logical axis, not merely enough index observations. */
export function benchmarkWindowIssues(instrumentBars: readonly Candle[], benchmarkBars: readonly Candle[], requiredCount: number): string[] {
  if (!Number.isSafeInteger(requiredCount) || requiredCount < 1) {
    return ['benchmark_invalid_required_window']
  }
  const axis = instrumentBars.slice(-requiredCount)
  if (axis.length < requiredCount) {
    return [`instrument_insufficient_regime_axis:${axis.length}/${requiredCount}`]
  }
  const first = axis[0]!.ts
  const last = axis.at(-1)!.ts
  const rows = benchmarkBars.filter(bar => bar.ts >= first && bar.ts <= last)
  if (rows.length !== axis.length) {
    return [`benchmark_incomplete_regime_axis:${rows.length}/${axis.length}`]
  }
  const modelKeys = ['barPolicyId', 'normalizationVersion', 'dataSource'] as const
  let previous = ''
  for (let i = 0; i < axis.length; i++) {
    const stock = axis[i]!
    const index = rows[i]!
    if (!Number.isFinite(Date.parse(stock.ts)) || stock.ts <= previous || index.ts !== stock.ts) {
      return ['benchmark_regime_session_axis_not_aligned']
    }
    if (!Number.isFinite(index.close) || index.close <= 0) {
      return ['benchmark_regime_close_invalid']
    }
    for (const key of modelKeys) {
      if ((stock[key] ?? null) !== (index[key] ?? null) || (stock[key] ?? null) !== (axis[0]![key] ?? null)) {
        return ['benchmark_regime_policy_not_comparable']
      }
    }
    if ((stock.physicalSessionDate ?? stock.sessionDate ?? null) !== (index.physicalSessionDate ?? index.sessionDate ?? null)
      || (stock.tradingDate ?? null) !== (index.tradingDate ?? null)) {
      return ['benchmark_regime_session_labels_not_comparable']
    }
    previous = stock.ts
  }
  return []
}

type Input = {
  bars: Candle[]
  quality: Pick<ResearchQuality, 'status' | 'issues'>
}
/** Single dependency contract for pinned rules. Context never silently becomes a mandatory input. */
function blockingSourceIssues(input: Input, label: string) {
  if (input.quality.status !== 'data_quality_blocked' && input.bars.length) {
    return []
  }
  const issues = input.quality.issues.filter(issue => !/^(historical_availability_unknown|source_adjustment_policy_unknown):/.test(issue))
  return issues.length ? issues : [`${label}_data_quality_blocked`]
}

export function signalDependencies({ rules, instrument, benchmark }: {
  rules: StrategyRules
  instrument: Input
  benchmark: Input | null
}) {
  const need = benchmarkNeed(rules)
  const instrumentIssues = blockingSourceIssues(instrument, 'instrument')
  const benchmarkIssues = benchmark ? blockingSourceIssues(benchmark, 'benchmark') : ['benchmark_missing']
  if (benchmark && benchmarkIssues.length === 0) {
    const last = instrument.bars.at(-1)
    const index = benchmark.bars.at(-1)
    if (last && index?.ts.slice(0, 10) !== last.ts.slice(0, 10)) {
      benchmarkIssues.push('benchmark_last_session_not_aligned')
    }
    if (last && index && (last.barPolicyId ?? last.normalizationVersion ?? 'legacy_daily') !== (index.barPolicyId ?? index.normalizationVersion ?? 'legacy_daily')) {
      benchmarkIssues.push('benchmark_bar_policy_not_comparable')
    }
    if (need === 'required_for_signal') {
      benchmarkIssues.push(...benchmarkWindowIssues(instrument.bars, benchmark.bars, rules.regimeSma!))
    }
  }
  const critical = [...instrumentIssues.map(issue => `instrument:${issue}`), ...(need === 'required_for_signal' ? benchmarkIssues.map(issue => `benchmark:${issue}`) : [])]
  return {
    benchmarkNeed: need,
    instrumentQuality: instrument.quality.status,
    benchmarkQuality: !benchmark ? 'missing' as const : benchmarkIssues.length ? 'blocked' as const : benchmark.quality.status,
    benchmarkUnavailableReason: benchmarkIssues.length ? benchmarkIssues.join('; ') : null,
    signalEligibility: {
      status: critical.length ? 'blocked' as const : 'eligible' as const,
      issues: critical,
    },
    contextLimitations: [...instrument.quality.issues, ...(benchmarkIssues.length ? benchmarkIssues.map(issue => `benchmark_context_unavailable:${issue}`) : benchmark?.quality.issues ?? [])],
  }
}

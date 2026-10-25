import type { StrategyRules } from '../../shared/types/investment'
import type { ResearchBarSelection } from '../../shared/types/market-data'
import { benchmarkNeed, signalDependencies } from '../domain/market/dependencies'
import { loadResearchBars } from './market'

/** The source loader validates the selected window before any bad observation could be dropped. */
export function signalRequiredBars(rules: StrategyRules) {
  return Math.max(210, rules.slowSma, rules.trendSma, rules.momentumLookback + 1, rules.breakoutLookback + 1, rules.regimeSma ?? 0)
}

/** Shared by screening, research and instrument APIs: identical source, cutoff and dependency policy. */
export async function loadSignalInputs({ instrumentId, benchmarkId, rules, asOf, selection }: {
  instrumentId: string
  benchmarkId: string | null
  rules: StrategyRules
  asOf: Date
  selection: ResearchBarSelection
}) {
  const physical = selection.policyId === 'physical_session_v1'
  const requiredBenchmark = benchmarkNeed(rules) === 'required_for_signal'
  let benchmarkLimit = physical ? 210 : 300
  if (requiredBenchmark) {
    benchmarkLimit = rules.regimeSma!
  }
  const [research, benchmarkResearch] = await Promise.all([
    loadResearchBars({
      instrumentId,
      asOf,
      purpose: 'signal',
      limit: physical ? signalRequiredBars(rules) : 400,
      selection,
    }),
    benchmarkId
      ? loadResearchBars({
          instrumentId: benchmarkId,
          asOf,
          purpose: 'signal',
          limit: benchmarkLimit,
          selection,
        }).catch(() => null)
      : Promise.resolve(null),
  ])
  const dependencies = signalDependencies({
    rules,
    instrument: research,
    benchmark: benchmarkResearch,
  })
  const benchmarkCandles = dependencies.benchmarkUnavailableReason ? [] : benchmarkResearch?.bars ?? []
  return {
    research,
    benchmarkResearch,
    dependencies,
    benchmarkCandles,
  }
}

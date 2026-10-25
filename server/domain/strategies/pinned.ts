import { createHash } from 'node:crypto'
import type { StrategyRules } from '../../../shared/types/investment'

export interface PinnedStrategy {
  strategyVersionId: string
  version: number
  rules: StrategyRules
  rulesHash: string
}

/** Stable across property ordering; only immutable JSON values are allowed as rule parameters. */
export function rulesHash(rules: StrategyRules) {
  return createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(rules).sort(([a], [b]) => a.localeCompare(b))))).digest('hex')
}

export function pinStrategy(version: {
  id: string
  version: number
  rules: StrategyRules
}): PinnedStrategy {
  const rules = structuredClone(version.rules)
  return {
    strategyVersionId: version.id,
    version: version.version,
    rules,
    rulesHash: rulesHash(rules),
  }
}

export function pinnedStrategy(pins: Record<string, PinnedStrategy> | null | undefined, strategy: string) {
  const pin = pins?.[strategy]
  if (!pin || rulesHash(pin.rules) !== pin.rulesHash) {
    throw new Error(`Версия правил не зафиксирована или повреждена: ${strategy}; legacy-run нельзя воспроизводить по текущим active правилам`)
  }
  return {
    ...structuredClone(pin),
    id: pin.strategyVersionId,
  }
}

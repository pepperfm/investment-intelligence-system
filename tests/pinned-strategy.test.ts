import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES } from '../server/domain/strategies/rules'
import { pinStrategy, pinnedStrategy, rulesHash } from '../server/domain/strategies/pinned'

describe('run-pinned strategy rules', () => {
  it('retains v1 after active selection changes to v5 and original input mutates', () => {
    const active = {
      id: 'v1-id',
      version: 1,
      rules: { ...DEFAULT_RULES.swing },
    }
    const pins = { swing: pinStrategy(active) }
    active.id = 'v5-id'
    active.version = 5
    active.rules.horizonDays = 120
    const replay = pinnedStrategy(pins, 'swing')
    expect(replay.id).toBe('v1-id')
    expect(replay.version).toBe(1)
    expect(replay.rules.horizonDays).toBe(DEFAULT_RULES.swing.horizonDays)
    expect(replay.rulesHash).toBe(rulesHash(DEFAULT_RULES.swing))
  })
  it('refuses unpinned legacy runs and corrupted rule hashes, never guesses active', () => {
    expect(() => pinnedStrategy(null, 'swing')).toThrow(/legacy/)
    const pin = pinStrategy({
      id: 'v1',
      version: 1,
      rules: DEFAULT_RULES.swing,
    })
    pin.rules.horizonDays += 1
    expect(() => pinnedStrategy({ swing: pin }, 'swing')).toThrow(/повреждена/)
  })
  it('uses a stable hash independent of rule property order', () => {
    const reordered = Object.fromEntries(Object.entries(DEFAULT_RULES.swing).reverse())
    expect(rulesHash(reordered as typeof DEFAULT_RULES.swing)).toBe(rulesHash(DEFAULT_RULES.swing))
  })
})

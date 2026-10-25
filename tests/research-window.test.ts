import { describe, expect, it } from 'vitest'
import { selectResearchWindow } from '../server/domain/market/research-window'
import type { PhysicalBarAssessment } from '../server/domain/market/source-policy'

const assessment = (date: string, status: PhysicalBarAssessment['status'] = 'research_usable_with_limits'): PhysicalBarAssessment => ({
  date,
  status,
  candle: null,
  issues: [],
  inputHash: 'synthetic-selection-test',
})
describe('required observation window (synthetic selection cases)', () => {
  it('retains a quarantine within lookback instead of compensating with an older good row', () => {
    const result = selectResearchWindow([assessment('2026-09-23'), assessment('2026-09-24', 'quarantined'), assessment('2026-09-25')], {
      asOf: new Date('2026-09-30'),
      limit: 2,
    })
    expect(result.selected.map(r => r.date)).toEqual(['2026-09-24', '2026-09-25'])
    expect(result.selected[0]?.status).toBe('quarantined')
  })
  it('rejects an unassignable corrupt date before it can vanish from the window', () => {
    const result = selectResearchWindow([assessment('bad-date', 'quarantined'), assessment('2026-09-24'), assessment('2026-09-25')], {
      asOf: new Date('2026-09-30'),
      limit: 2,
    })
    expect(result.issues).toContain('invalid_source_period_unassignable')
    expect(selectResearchWindow([assessment('2026-02-30', 'quarantined')], { asOf: new Date('2026-09-30') }).issues).toContain('invalid_source_period_unassignable')
  })
  it('does not block an unrelated old duplicate outside the used window', () => {
    const result = selectResearchWindow([assessment('2024-01-03'), assessment('2024-01-03'), assessment('2026-09-24'), assessment('2026-09-25')], {
      asOf: new Date('2026-09-30'),
      limit: 2,
    })
    expect(result.issues).toEqual([])
  })
  it('excludes future pending periods before taking the actual historical window', () => {
    const result = selectResearchWindow([assessment('2026-09-23'), assessment('2026-09-24'), assessment('2026-09-28', 'pending_confirmation')], {
      asOf: new Date('2026-09-28T10:00Z'),
      limit: 2,
    })
    expect(result.selected.map(r => r.date)).toEqual(['2026-09-23', '2026-09-24'])
  })
})

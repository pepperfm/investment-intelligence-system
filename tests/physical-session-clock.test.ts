import { describe, expect, it } from 'vitest'
import { createPhysicalSessionClock, researchSessionClock, PHYSICAL_CLOCK_VERSION, type PhysicalSessionFact, type SessionCoverage } from '../server/domain/market/physical-session-clock'
import { scenarioDeadlineForClock } from '../server/domain/market/scenario-deadline'

/** Structural fixtures test the clock; these are not verification of a market-data feed. */
const fact = (date: string, overrides: Partial<PhysicalSessionFact> = {}): PhysicalSessionFact => ({
  sessionDate: date,
  status: 'open',
  sessionType: 'regular',
  opensAt: `${date}T09:50:00+03:00`,
  completedAt: `${date}T23:50:00+03:00`,
  availableAt: `${date}T23:51:00+03:00`,
  observedAt: `${date}T23:51:00+03:00`,
  evidenceKind: 'observed_session',
  sourceRevision: 'fixture-source-v1',
  sourceHash: 'fixture-response-hash',
  evidenceUrl: 'https://example.test/fixture',
  ...overrides,
})
const coverage = (from: string, to: string): SessionCoverage => ({
  from,
  to,
  sourceRevision: 'fixture-source-v1',
  sourceHash: 'fixture-response-hash',
  observedAt: `${to}T23:55:00+03:00`,
  complete: true,
})
const build = (facts: PhysicalSessionFact[], asOf: string, ranges: SessionCoverage[] = [], reconstruction = false) => createPhysicalSessionClock({
  instrumentId: 'ROSN',
  board: 'TQBR',
  facts,
  asOf: new Date(asOf),
  coverage: ranges,
  reconstruction,
})
const entry = {
  type: 'market_next_open' as const,
  price: 100,
  validDays: 2,
  note: '',
}
const exit = {
  stopLoss: 95,
  takeProfit: 110,
  timeExitDays: 2,
  note: '',
}

describe('bounded physical session clock', () => {
  it('uses confirmed dated facts across 2024–2026 with no year or weekday guess', () => {
    for (const date of ['2024-01-06', '2025-03-01', '2026-09-26']) {
      const clock = build([fact(date)], '2026-09-27T20:59:59Z')
      expect(clock.version).toBe(PHYSICAL_CLOCK_VERSION)
      expect(clock.session(date).status).toBe('open')
    }
    const clock = build([], '2026-09-27T20:59:59Z')
    expect(clock.session('2024-01-01').status).toBe('unknown')
    expect(clock.session('2025-03-03').status).toBe('unknown')
    expect(clock.session('2026-09-27').status).toBe('unknown')
  })
  it('counts separate confirmed weekend observations without changing logical trading dates', () => {
    const clock = build(['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28'].map(date => fact(date)), '2026-09-28T20:59:59Z', [coverage('2026-09-25', '2026-09-28')])
    expect(clock.completedSessions(new Date('2026-09-25T20:50:00Z'), new Date('2026-09-28T20:59:59Z')).map(row => row.sessionDate)).toEqual(['2026-09-26', '2026-09-27', '2026-09-28'])
    expect(clock.stale('2026-09-25T20:50:00Z')).toMatchObject({
      status: 'known',
      sessions: 3,
    })
  })
  it('does not turn absence within complete source coverage into a closed calendar day', () => {
    const clock = build([fact('2026-10-23'), fact('2026-10-26')], '2026-10-26T20:59:59Z', [coverage('2026-10-23', '2026-10-26')])
    expect(clock.session('2026-10-24').status).toBe('unknown')
    expect(clock.stale('2026-10-23T20:50:00Z')).toMatchObject({
      status: 'known',
      sessions: 1,
    })
    const unbounded = build([fact('2026-10-23'), fact('2026-10-26')], '2026-10-26T20:59:59Z')
    expect(unbounded.stale('2026-10-23T20:50:00Z')).toMatchObject({
      status: 'unknown',
      sessions: null,
    })
  })
  it('accepts explicit observed closures and quarantines conflicts instead of deduplicating silently', () => {
    const closed = fact('2026-10-24', {
      status: 'closed',
      sessionType: 'holiday',
      opensAt: null,
      completedAt: null,
    })
    expect(build([closed], '2026-10-25T20:59:59Z').session('2026-10-24').status).toBe('closed')
    const contradictory = build([closed, fact('2026-10-24')], '2026-10-25T20:59:59Z')
    expect(contradictory.session('2026-10-24').status).toBe('unknown')
    expect(contradictory.stale('2026-10-23T20:50:00Z').status).toBe('unknown')
  })
  it('excludes incomplete or not-yet-available observations at the Friday cutoff', () => {
    const friday = fact('2026-09-25')
    const saturday = fact('2026-09-26')
    const clock = build([friday, saturday], '2026-09-25T20:59:59Z')
    expect(clock.completedSessions(new Date('2026-09-24'), new Date('2026-09-29')).map(row => row.sessionDate)).toEqual(['2026-09-25'])
    expect(clock.session('2026-09-26').status).toBe('unknown')
    const intraday = build([friday], '2026-09-25T15:00:00Z')
    expect(intraday.completedSessions(new Date('2026-09-24'), new Date('2026-09-26'))).toEqual([])
  })
  it('makes reconstruction explicit and cannot backdate an unpublished future schedule', () => {
    const laterObserved = fact('2024-01-05', { observedAt: '2026-10-25T12:00:00Z' })
    expect(build([laterObserved], '2024-01-05T20:59:59Z').session('2024-01-05').status).toBe('unknown')
    const reconstruct = build([laterObserved], '2024-01-05T20:59:59Z', [coverage('2024-01-05', '2024-01-05')], true)
    expect(reconstruct.reconstruction).toBe(true)
    expect(reconstruct.session('2024-01-05').status).toBe('open')
    const schedule = {
      ...laterObserved,
      evidenceKind: 'published_schedule' as const,
    }
    expect(build([schedule], '2024-01-05T20:59:59Z', [], true).session('2024-01-05').status).toBe('unknown')
  })
})

describe('future physical deadlines', () => {
  const asOf = new Date('2026-09-25T20:59:59Z')
  const schedule = (date: string, overrides: Partial<PhysicalSessionFact> = {}) => fact(date, {
    evidenceKind: 'published_schedule',
    availableAt: '2026-09-01T00:00:00Z',
    observedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  })
  it('returns conditional/null when future dates are not explicitly scheduled', () => {
    const clock = build([fact('2026-09-25')], asOf.toISOString())
    expect(scenarioDeadlineForClock(asOf, entry, exit, clock)).toMatchObject({
      status: 'conditional',
      checkAt: null,
      requiredSessions: 2,
    })
  })
  it('counts two published physical sessions across Saturday/Sunday, not two logical days', () => {
    const clock = build([fact('2026-09-25'), schedule('2026-09-26'), schedule('2026-09-27')], asOf.toISOString())
    expect(clock.deadline(asOf, entry, exit)).toMatchObject({
      status: 'known',
      checkAt: '2026-09-27T23:50:00+03:00',
      confirmedSessions: 2,
    })
  })
  it('does not skip an unknown day or invent closure even if later opens are published', () => {
    const clock = build([fact('2026-09-25'), schedule('2026-09-28'), schedule('2026-09-29')], asOf.toISOString())
    expect(clock.deadline(asOf, entry, exit)).toMatchObject({
      status: 'conditional',
      checkAt: null,
    })
  })
  it('uses explicit closed days, and a limit window includes the last possible entry session', () => {
    const closed = (date: string) => schedule(date, {
      status: 'closed',
      sessionType: 'holiday',
      opensAt: null,
      completedAt: null,
    })
    const clock = build([fact('2026-09-25'), closed('2026-09-26'), closed('2026-09-27'), schedule('2026-09-28'), schedule('2026-09-29'), schedule('2026-09-30')], asOf.toISOString())
    expect(clock.deadline(asOf, {
      ...entry,
      type: 'limit',
    }, exit)).toMatchObject({
      status: 'known',
      requiredSessions: 3,
      checkAt: '2026-09-30T23:50:00+03:00',
    })
  })
  it('rejects invalid horizon/cutoff rather than returning a fabricated time', () => {
    const clock = build([fact('2026-09-25')], asOf.toISOString())
    expect(clock.deadline(new Date('2026-09-24'), entry, exit).status).toBe('unknown')
    expect(clock.deadline(asOf, entry, {
      ...exit,
      timeExitDays: 0,
    }).status).toBe('unknown')
  })
})

describe('research reconstruction clock adapter', () => {
  it('uses the explicit buffer and bounded audited coverage, never a seven-calendar-day freshness guess', () => {
    const bars = ['2024-01-05', '2024-01-06', '2024-01-07'].map(date => ({
      ts: `${date}T00:00:00Z`,
      open: 100,
      high: 110,
      low: 90,
      close: 100,
      volume: 1,
      physicalSessionDate: date,
      sessionType: 'unknown' as const,
      earliestUseAt: new Date(Date.parse(`${date}T00:00:00+03:00`) + 2 * 86400000).toISOString(),
      observedAt: '2026-10-25T00:00:00Z',
      sourceRevision: 'source-v1',
      provenanceHash: `hash-${date}`,
    }))
    const provenance = {
      instrument: 'ROSN',
      board: 'TQBR',
      calendarVersion: 'physical-fixture',
      sourceRevision: 'source-v1',
      reconstruction: true,
      observedAt: '2026-10-25T00:00:00Z',
      coverage: {
        from: '2024-01-05',
        to: '2024-01-10',
        observedAt: '2026-10-25T00:00:00Z',
        hash: 'bounded-source-hash',
      },
    }
    const asOf = new Date('2024-01-10T12:00:00Z')
    const clock = researchSessionClock(bars, provenance, asOf)
    expect(clock.stale(bars[0]!.earliestUseAt)).toMatchObject({
      status: 'known',
      sessions: 2,
    })
    expect(clock.stale(bars.at(-1)!.earliestUseAt)).toMatchObject({
      status: 'known',
      sessions: 0,
    })
    expect(clock.session('2024-01-08').status).toBe('unknown')
    expect(researchSessionClock(bars, {
      ...provenance,
      coverage: undefined,
    }, asOf).stale(bars.at(-1)!.earliestUseAt).status).toBe('unknown')
    expect(clock.completedSessions(new Date('2024-01-01'), new Date('2024-01-08T00:00:00Z')).map(row => row.sessionDate)).toEqual(['2024-01-05', '2024-01-06'])
  })
})

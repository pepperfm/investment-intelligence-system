import type { EntryScenario, ExitScenario } from '../../../shared/types/investment'
import { moscowDate } from './calendar'

export const PHYSICAL_CLOCK_VERSION = 'physical-session-facts-v1'
const DAY = 86_400_000

type SessionKind = 'regular' | 'weekend_additional' | 'holiday' | 'unknown'

/** A scoped fact, not a weekday-derived calendar or instrument admission assumption. */
export interface PhysicalSessionFact {
  sessionDate: string
  status: 'open' | 'closed'
  sessionType: SessionKind
  opensAt: string | null
  completedAt: string | null
  /** A conservative eligibility instant is not an asserted physical session close. */
  completionMeaning?: 'session_end' | 'finalization_buffer'
  /** First eligible use of the fact in the declared live/reconstruction mode. */
  availableAt: string
  observedAt: string
  evidenceKind: 'observed_session' | 'published_schedule'
  sourceRevision: string
  sourceHash: string
  evidenceUrl: string
}

/** Complete bounded response verified by the source adapter/audit, not by this clock. */
export interface SessionCoverage {
  from: string
  to: string
  sourceRevision: string
  sourceHash: string
  observedAt: string
  complete: true
}

export interface PhysicalClockOptions {
  instrumentId: string
  board: string
  version?: string
  asOf: Date
  facts: PhysicalSessionFact[]
  coverage: SessionCoverage[]
  /** Historical response observed later; never claim IIS knew these sessions at historical asOf. */
  reconstruction?: boolean
}

export interface ClockDeadline {
  status: 'known' | 'conditional' | 'unknown'
  checkAt: string | null
  requiredSessions: number
  confirmedSessions: number
  issues: string[]
}

export interface BarClock {
  policyId: 'physical_session_v1'
  unit: 'confirmed_sessions'
  version: string
  instrumentId: string
  board: string
  reconstruction: boolean
  session: (date: string) => {
    status: 'open' | 'closed' | 'unknown'
    fact: PhysicalSessionFact | null
  }
  completedSessions: (from: Date, to: Date) => PhysicalSessionFact[]
  stale: (lastCompletedAt: string | undefined) => {
    status: 'known' | 'unknown'
    sessions: number | null
    issues: string[]
  }
  deadline: (asOf: Date, entry: EntryScenario, exit: ExitScenario) => ClockDeadline
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

function instant(value: string | null) {
  return value === null ? NaN : Date.parse(value)
}

/**
 * A physical clock counts confirmed observations. Missing dates stay unknown, including weekends.
 * Complete response coverage permits bounded counting but does not turn missing dates into closures.
 * No provider/model/global calendar is guessed, and duplicate conflicting facts are quarantined.
 */
export function createPhysicalSessionClock(options: PhysicalClockOptions): BarClock {
  const cutoff = options.asOf.getTime()
  const conflicts = new Set<string>()
  const facts = new Map<string, PhysicalSessionFact>()
  const issues: string[] = []
  if (!Number.isFinite(cutoff) || !options.instrumentId || !options.board) {
    issues.push('clock_scope_or_asof_invalid')
  }
  for (const fact of options.facts) {
    if (!validDate(fact.sessionDate) || !fact.sourceHash || !fact.sourceRevision || !fact.evidenceUrl
      || !Number.isFinite(instant(fact.observedAt)) || !Number.isFinite(instant(fact.availableAt))) {
      issues.push(`invalid_session_fact:${fact.sessionDate}`)
      conflicts.add(fact.sessionDate)
      continue
    }
    // Published schedules cannot be reconstructed as if they were published before they actually were.
    if (instant(fact.availableAt) > cutoff || (instant(fact.observedAt) > cutoff
      && (!options.reconstruction || fact.evidenceKind === 'published_schedule'))) {
      continue
    }
    if (fact.status === 'closed' && (fact.opensAt !== null || fact.completedAt !== null)) {
      issues.push(`closed_session_has_bounds:${fact.sessionDate}`)
      conflicts.add(fact.sessionDate)
      continue
    }
    const bufferedObservation = fact.evidenceKind === 'observed_session' && fact.completionMeaning === 'finalization_buffer'
    const validBufferedBounds = bufferedObservation && fact.opensAt === null && Number.isFinite(instant(fact.completedAt))
      && instant(fact.completedAt) >= Date.parse(`${fact.sessionDate}T00:00:00+03:00`)
    const validSessionBounds = Number.isFinite(instant(fact.opensAt)) && Number.isFinite(instant(fact.completedAt))
      && instant(fact.completedAt) >= instant(fact.opensAt)
      && moscowDate(new Date(fact.opensAt!)) === fact.sessionDate
      && moscowDate(new Date(fact.completedAt!)) === fact.sessionDate
    if (fact.status === 'open' && !validBufferedBounds && !validSessionBounds) {
      issues.push(`invalid_session_bounds:${fact.sessionDate}`)
      conflicts.add(fact.sessionDate)
      continue
    }
    if (fact.evidenceKind === 'observed_session' && fact.status === 'open'
      && (instant(fact.availableAt) < instant(fact.completedAt) || instant(fact.observedAt) < instant(fact.completedAt))) {
      issues.push(`observed_session_precedes_completion:${fact.sessionDate}`)
      conflicts.add(fact.sessionDate)
      continue
    }
    // An observed bar cannot prove future trades; only an already-published schedule may describe them.
    if (fact.evidenceKind === 'observed_session' && instant(fact.completedAt) > cutoff) {
      continue
    }
    const prior = facts.get(fact.sessionDate)
    if (prior && (prior.status !== fact.status || prior.opensAt !== fact.opensAt || prior.completedAt !== fact.completedAt || prior.completionMeaning !== fact.completionMeaning)) {
      conflicts.add(fact.sessionDate)
      issues.push(`conflicting_session_fact:${fact.sessionDate}`)
      continue
    }
    if (!prior) {
      facts.set(fact.sessionDate, { ...fact })
    }
  }
  for (const date of conflicts) {
    facts.delete(date)
  }
  const knownCoverage = options.coverage.map(coverage => ({ ...coverage })).filter(coverage => validDate(coverage.from) && validDate(coverage.to)
    && coverage.from <= coverage.to && coverage.complete === true && !!coverage.sourceHash && !!coverage.sourceRevision
    && Number.isFinite(instant(coverage.observedAt)) && (options.reconstruction || instant(coverage.observedAt) <= cutoff))
  const all = [...facts.values()].sort((a, b) => a.sessionDate.localeCompare(b.sessionDate))
  const scopeIssues = () => [...issues]
  const hasCoverage = (from: string, to: string) => {
    const ranges = knownCoverage.filter(range => range.to >= from && range.from <= to).sort((a, b) => a.from.localeCompare(b.from))
    let current = from
    for (const range of ranges) {
      if (range.from > current) {
        return false
      }
      if (range.to >= to) {
        return true
      }
      if (range.to >= current) {
        current = new Date(Date.parse(`${range.to}T00:00:00Z`) + DAY).toISOString().slice(0, 10)
      }
    }
    return false
  }
  const completedSessions = (from: Date, to: Date) => all.filter(fact => fact.status === 'open'
    && instant(fact.completedAt) > from.getTime() && instant(fact.completedAt) <= Math.min(to.getTime(), cutoff)
    && instant(fact.availableAt) <= Math.min(to.getTime(), cutoff)).map(fact => ({ ...fact }))
  return {
    policyId: 'physical_session_v1',
    unit: 'confirmed_sessions',
    version: options.version ?? PHYSICAL_CLOCK_VERSION,
    instrumentId: options.instrumentId,
    board: options.board,
    reconstruction: options.reconstruction === true,
    session: date => ({
      status: facts.get(date)?.status ?? 'unknown',
      fact: facts.get(date) ? { ...facts.get(date)! } : null,
    }),
    completedSessions,
    stale(lastCompletedAt) {
      const last = instant(lastCompletedAt ?? null)
      const localIssues = scopeIssues()
      if (!Number.isFinite(last) || last > cutoff) {
        localIssues.push('last_session_missing_or_future')
      } else if (!all.some(fact => fact.status === 'open' && instant(fact.completedAt) === last)) {
        localIssues.push('last_session_not_confirmed')
      } else if (!hasCoverage(all.find(fact => fact.status === 'open' && instant(fact.completedAt) === last)!.sessionDate, moscowDate(new Date(cutoff)))) {
        localIssues.push('session_coverage_not_confirmed_for_stale_window')
      }
      if (localIssues.length) {
        return {
          status: 'unknown',
          sessions: null,
          issues: localIssues,
        }
      }
      return {
        status: 'known',
        sessions: completedSessions(new Date(last), options.asOf).length,
        issues: [],
      }
    },
    deadline(asOf, entry, exit) {
      const requiredSessions = (entry.type === 'market_next_open' ? 1 : entry.validDays) + exit.timeExitDays - 1
      const localIssues = scopeIssues()
      if (!Number.isFinite(asOf.getTime()) || asOf.getTime() !== cutoff || !Number.isSafeInteger(requiredSessions) || requiredSessions < 1 || !Number.isSafeInteger(entry.validDays) || entry.validDays < 1 || !Number.isSafeInteger(exit.timeExitDays) || exit.timeExitDays < 1) {
        return {
          status: 'unknown',
          checkAt: null,
          requiredSessions,
          confirmedSessions: 0,
          issues: [...localIssues, 'invalid_deadline_scope_or_horizon'],
        }
      }
      const scheduled = all.filter(fact => fact.status === 'open' && fact.evidenceKind === 'published_schedule' && instant(fact.opensAt) > asOf.getTime())
      // Exact deadline requires an explicit open/closed schedule for every intervening physical date.
      let counted = 0
      let cursor = moscowDate(asOf)
      const end = scheduled.at(-1)?.sessionDate
      while (end && cursor <= end) {
        const fact = facts.get(cursor)
        const sameDayAlreadyEnded = cursor === moscowDate(asOf) && fact && (fact.status === 'closed' || instant(fact.opensAt) <= cutoff)
        if (!sameDayAlreadyEnded && (!fact || fact.evidenceKind !== 'published_schedule')) {
          localIssues.push(`future_schedule_unknown:${cursor}`)
          break
        }
        if (fact?.status === 'open' && fact.evidenceKind === 'published_schedule' && instant(fact.opensAt) > cutoff) {
          counted++
          if (counted === requiredSessions && !localIssues.length) {
            return {
              status: 'known',
              checkAt: fact.completedAt,
              requiredSessions,
              confirmedSessions: counted,
              issues: [],
            }
          }
        }
        cursor = new Date(Date.parse(`${cursor}T00:00:00Z`) + DAY).toISOString().slice(0, 10)
      }
      return {
        status: localIssues.length && issues.length ? 'unknown' : 'conditional',
        checkAt: null,
        requiredSessions,
        confirmedSessions: counted,
        issues: [...localIssues, 'future_session_deadline_requires_published_schedule'],
      }
    },
  }
}

/** Adapter for an already-audited research series; eligibility buffers are never labelled actual closes. */
export function researchSessionClock(
  bars: import('../../../shared/types/investment').Candle[],
  provenance: {
    instrument: string
    board: string
    calendarVersion: string
    sourceRevision: string
    reconstruction: boolean
    observedAt: string | null
    coverage?: {
      from: string
      to: string
      observedAt: string
      hash: string
    }
  },
  asOf: Date,
) {
  const facts: PhysicalSessionFact[] = bars.map(bar => ({
    sessionDate: bar.physicalSessionDate ?? bar.sessionDate ?? '',
    status: 'open',
    sessionType: bar.sessionType ?? 'unknown',
    opensAt: null,
    completedAt: bar.earliestUseAt ?? null,
    completionMeaning: 'finalization_buffer',
    availableAt: bar.earliestUseAt ?? '',
    observedAt: bar.observedAt ?? provenance.observedAt ?? '',
    evidenceKind: 'observed_session',
    sourceRevision: bar.sourceRevision ?? provenance.sourceRevision,
    sourceHash: bar.provenanceHash ?? '',
    evidenceUrl: 'https://iss.moex.com/iss/',
  }))
  const coverage: SessionCoverage[] = provenance.coverage
    ? [{
        from: provenance.coverage.from,
        to: provenance.coverage.to,
        sourceRevision: provenance.sourceRevision,
        sourceHash: provenance.coverage.hash,
        observedAt: provenance.coverage.observedAt,
        complete: true,
      }]
    : []
  return createPhysicalSessionClock({
    instrumentId: provenance.instrument,
    board: provenance.board,
    version: provenance.calendarVersion,
    asOf,
    facts,
    coverage,
    reconstruction: provenance.reconstruction,
  })
}

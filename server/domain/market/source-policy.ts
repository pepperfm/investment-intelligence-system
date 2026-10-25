import { createHash } from 'node:crypto'
import type { Candle } from '../../../shared/types/investment'

export const PHYSICAL_POLICY_VERSION = 'moex-iss-daily-hourly-physical-v1'
export interface IssBar {
  begin: string
  end: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}
export interface PhysicalBarAssessment {
  date: string
  status: 'research_usable_with_limits' | 'quarantined' | 'pending_confirmation'
  issues: string[]
  candle: Candle | null
  inputHash: string
}
export function marketHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
const physicalDate = (bar: IssBar) => bar.begin.slice(0, 10)
const instant = (value: string) => Date.parse(value.replace(' ', 'T') + '+03:00')
const valid = (b: IssBar) => [b.open, b.high, b.low, b.close, b.volume].every(Number.isFinite) && Math.min(b.open, b.high, b.low, b.close) > 0 && b.volume >= 0 && b.low <= Math.min(b.open, b.close) && b.high >= Math.max(b.open, b.close) && b.high >= b.low

/** Per-date evidence, not a global verified switch. No conversion to logical trading days. */
export function reconcilePhysicalBars(daily: IssBar[], hourly: IssBar[], context: {
  board: string
  market: string
  kind: string
  observedAt: string
  responseHash: string
  endpoint: string
  complete: boolean
}): PhysicalBarAssessment[] {
  const dates = [...new Set([...daily, ...hourly].map(physicalDate))].sort()
  return dates.map((date) => {
    const days = daily.filter(b => physicalDate(b) === date)
    const hours = hourly.filter(b => physicalDate(b) === date)
    const issues: string[] = []
    if (!Number.isFinite(Date.parse(context.observedAt))) {
      issues.push('invalid_observation_time')
    }
    const inputHash = marketHash({
      days,
      hours,
      context,
    })
    if (!context.complete) {
      issues.push('incomplete_source_response')
    }
    if (!((context.kind === 'equity' && context.market === 'shares' && context.board === 'TQBR') || (context.kind === 'index' && context.market === 'index' && context.board === 'SNDX'))) {
      issues.push('unsupported_market_board')
    }
    if (days.length !== 1) {
      issues.push(days.length ? 'duplicate_daily_period' : 'missing_daily_period')
    }
    if (!hours.length) {
      issues.push('intraday_confirmation_missing')
    }
    let previousEnd = -Infinity
    for (const h of hours) {
      if (!valid(h) || !Number.isFinite(instant(h.begin)) || !Number.isFinite(instant(h.end)) || instant(h.begin) <= previousEnd || instant(h.end) < instant(h.begin) || h.end.slice(0, 10) !== date) {
        issues.push('invalid_or_overlapping_intraday')
      }
      previousEnd = instant(h.end)
    }
    const day = days[0]
    if (day && (day.end.slice(0, 10) !== date || !Number.isFinite(instant(day.begin)) || !Number.isFinite(instant(day.end)) || instant(day.end) < instant(day.begin))) {
      issues.push('invalid_daily_interval')
    }
    if (day && !valid(day)) {
      issues.push('invalid_daily_ohlcv')
    }
    if (day && hours.length) {
      const aggregate = {
        open: hours[0]!.open,
        high: Math.max(...hours.map(h => h.high)),
        low: Math.min(...hours.map(h => h.low)),
        close: hours.at(-1)!.close,
        volume: hours.reduce((n, h) => n + h.volume, 0),
      }
      for (const key of ['open', 'high', 'low', 'close', 'volume'] as const) {
        if (Math.abs(day[key] - aggregate[key]) > Math.max(1e-7, Math.abs(day[key]) * 1e-10)) {
          issues.push(`daily_intraday_mismatch:${key}`)
        }
      }
    }
    // The endpoint labels are interval bounds, not the actual last trade. Use a whole-day
    // finalization buffer. Historical publication latency stays UNKNOWN, never backdated.
    const earliestUseAt = new Date(Date.parse(`${date}T00:00:00+03:00`) + 2 * 86_400_000).toISOString()
    const pending = Date.parse(context.observedAt) < Date.parse(earliestUseAt)
    const status = issues.length ? 'quarantined' : pending ? 'pending_confirmation' : 'research_usable_with_limits'
    return {
      date,
      status,
      issues: [...new Set(issues)],
      inputHash,
      candle: day
        ? {
            ts: `${date}T00:00:00.000Z`,
            open: day.open,
            high: day.high,
            low: day.low,
            close: day.close,
            volume: day.volume,
            dataSource: 'moex_iss',
            board: context.board,
            sessionDate: date,
            physicalSessionDate: date,
            sessionType: [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay()) ? 'weekend_additional' : 'regular',
            normalizationVersion: PHYSICAL_POLICY_VERSION,
            barPolicyId: 'physical_session_v1',
            completedAt: earliestUseAt,
            availableAt: context.observedAt,
            earliestUseAt,
            observedAt: context.observedAt,
            historicalAvailability: 'unknown',
            reconstruction: true,
            adjustmentPolicy: 'source_native_adjustment_unknown',
            sourceRevision: context.responseHash,
            provenanceHash: inputHash,
          }
        : null,
    }
  })
}

const DAY = 86_400_000
export const CALENDAR_VERSION = 'moex-stocks-2026-v2'
export const MOCK_CALENDAR_VERSION = 'mock-weekday-v1'
export const CALENDAR_SOURCES = ['https://www.moex.com/n95564', 'https://www.moex.com/n96571', 'https://www.moex.com/n103931', 'https://www.moex.com/a8920'] as const

export interface CalendarOptions {
  provider?: 'finam' | 'mock'
  board?: string
  /** Schedule knowledge cutoff; defaults to the bundled schedule revision. */
  asOf?: Date
}

export class CalendarUnavailableError extends Error {
  constructor(date: string) {
    super(`data_quality_blocked: MOEX schedule is not verified for ${date}`)
    this.name = 'CalendarUnavailableError'
  }
}

const CLOSED_WEEKENDS = new Set([
  '01-03', '01-04', '01-10', '01-11', '02-14', '02-15', '03-07', '03-08', '03-21', '03-22',
  '05-09', '05-10', '06-20', '06-21', '08-01', '08-02', '08-15', '08-16', '09-12', '09-13', '10-24', '10-25',
])
const CLOSED_HOLIDAYS = new Set(['01-01', '01-02', '01-07', '03-08', '05-09', '12-31'])
const ADDITIONAL_HOLIDAYS = new Set(['02-23', '05-01', '06-12', '11-04'])
const HOLIDAY_PUBLICATION = Date.parse('2025-12-30T07:34:00Z')
const AMENDMENT_PUBLICATION = Date.parse('2026-09-04T08:00:00Z')

export function calendarVersion(options: CalendarOptions = {}) {
  if (options.provider === 'mock') {
    return MOCK_CALENDAR_VERSION
  }
  if (options.asOf && options.asOf.getTime() < AMENDMENT_PUBLICATION) {
    return 'moex-stocks-2026-v1'
  }
  return CALENDAR_VERSION
}

/** UTC midnight date label, not the physical beginning of a Moscow session. */
export function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/** Physical calendar date in Moscow; use this for instants, never for UTC date labels. */
export function moscowDate(date: Date) {
  return new Date(date.getTime() + 3 * 3_600_000).toISOString().slice(0, 10)
}

function verified(date: Date, options: CalendarOptions) {
  if (!Number.isFinite(date.getTime())) {
    throw new CalendarUnavailableError('invalid date')
  }
  if (options.provider === 'mock') {
    return
  }
  if (date.getUTCFullYear() !== 2026 || !Number.isFinite(date.getTime())
    || (options.board && !['TQBR', 'SNDX', 'TQTF', 'TQIF', 'TQTY'].includes(options.board))
    || (options.asOf && options.asOf.getTime() < HOLIDAY_PUBLICATION)) {
    throw new CalendarUnavailableError(Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : 'invalid date')
  }
}

/** A distinct logical regular trading day; additional sessions do not add another day. */
export function isTradingDay(date: Date, options: CalendarOptions = {}) {
  verified(date, options)
  const day = date.getUTCDay()
  if (day === 0 || day === 6) {
    return false
  }
  if (options.provider === 'mock') {
    return true
  }
  const md = date.toISOString().slice(5, 10)
  return !CLOSED_HOLIDAYS.has(md) && !ADDITIONAL_HOLIDAYS.has(md)
}

export function addTradingDays(date: Date, days: number, options: CalendarOptions = {}) {
  if (!Number.isSafeInteger(days) || days < 0) {
    throw new RangeError('Trading days must be a non-negative integer')
  }
  let current = startOfUtcDay(date)
  verified(current, options)
  let left = days
  while (left > 0) {
    current = new Date(current.getTime() + DAY)
    if (isTradingDay(current, options)) {
      left--
    }
  }
  return current
}

export function tradingDaysBetween(from: Date, to: Date, options: CalendarOptions = {}) {
  const result: Date[] = []
  let current = startOfUtcDay(from)
  const end = startOfUtcDay(to).getTime()
  verified(current, options)
  verified(to, options)
  while (current.getTime() <= end) {
    if (isTradingDay(current, options)) {
      result.push(current)
    }
    current = new Date(current.getTime() + DAY)
  }
  return result
}

export interface SessionOptions extends CalendarOptions {
  symbol?: string
  /** Must come from a dated instrument/board admission record, not the ticker name. */
  weekendEligible?: boolean
}

/** Inspect a physical Moscow date. Market schedule alone cannot establish instrument eligibility. */
export function inspectSession(date: Date, options: SessionOptions = {}) {
  const sessionDate = moscowDate(date)
  const label = new Date(`${sessionDate}T00:00:00Z`)
  const base = {
    sessionDate,
    calendarVersion: calendarVersion(options),
    board: options.board ?? null,
    symbol: options.symbol ?? null,
  }
  try {
    verified(label, options)
    if (options.provider === 'mock') {
      return {
        ...base,
        status: isTradingDay(label, options) ? 'open' as const : 'closed' as const,
        sessionType: 'regular' as const,
        tradingDate: isTradingDay(label, options) ? sessionDate : null,
        opensAt: null,
        closesAt: null,
      }
    }
    const md = sessionDate.slice(5)
    const weekend = [0, 6].includes(label.getUTCDay())
    const amended = !options.asOf || options.asOf.getTime() >= AMENDMENT_PUBLICATION
    const amendmentClosures = amended ? ['11-28', '11-29'] : ['12-05', '12-06']
    if (CLOSED_HOLIDAYS.has(md) || (weekend && (CLOSED_WEEKENDS.has(md) || amendmentClosures.includes(md)))) {
      return {
        ...base,
        status: 'closed' as const,
        sessionType: 'holiday' as const,
        tradingDate: null,
        opensAt: null,
        closesAt: null,
      }
    }
    if (weekend || ADDITIONAL_HOLIDAYS.has(md)) {
      const tradingDate = addTradingDays(label, 1, options).toISOString().slice(0, 10)
      const eligible = options.weekendEligible
      let status: 'open' | 'closed' | 'unknown' = 'unknown'
      if (eligible === true) {
        status = 'open'
      } else if (eligible === false) {
        status = 'closed'
      }
      return {
        ...base,
        status,
        sessionType: 'weekend_additional' as const,
        tradingDate,
        opensAt: eligible ? `${sessionDate}T09:50:00+03:00` : null,
        closesAt: eligible ? `${sessionDate}T19:00:00+03:00` : null,
      }
    }
    // Intraday admission differs by security; no generic opening time is invented.
    return {
      ...base,
      status: 'open' as const,
      sessionType: 'regular' as const,
      tradingDate: sessionDate,
      opensAt: null,
      closesAt: null,
    }
  } catch {
    return {
      ...base,
      status: 'unknown' as const,
      sessionType: 'unknown' as const,
      tradingDate: null,
      opensAt: null,
      closesAt: null,
    }
  }
}

/** Logical trading-day age. Unknown schedule is infinitely stale, never an asserted fresh observation. */
export function staleDays(lastTs: string | Date | undefined, asOf: Date, options: CalendarOptions = {}) {
  if (!lastTs) {
    return Infinity
  }
  const last = startOfUtcDay(new Date(lastTs))
  const end = startOfUtcDay(asOf)
  if (!Number.isFinite(last.getTime()) || last > end) {
    return Infinity
  }
  try {
    verified(last, options)
    verified(end, options)
    if (last.getTime() === end.getTime()) {
      return 0
    }
    return tradingDaysBetween(new Date(last.getTime() + DAY), end, options).length
  } catch {
    return Infinity
  }
}

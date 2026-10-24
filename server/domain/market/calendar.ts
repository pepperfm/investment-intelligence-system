const DAY = 86_400_000

/** Trading-day approximation: weekdays only. MOEX holidays are not modelled yet (see IMPLEMENTATION_PLAN). */
export function isTradingDay(date: Date) {
  const day = date.getUTCDay()
  return day !== 0 && day !== 6
}

export function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export function addTradingDays(date: Date, days: number) {
  let current = startOfUtcDay(date)
  let left = days
  while (left > 0) {
    current = new Date(current.getTime() + DAY)
    if (isTradingDay(current)) {
      left--
    }
  }
  return current
}

export function tradingDaysBetween(from: Date, to: Date) {
  const result: Date[] = []
  let current = startOfUtcDay(from)
  const end = startOfUtcDay(to).getTime()
  while (current.getTime() <= end) {
    if (isTradingDay(current)) {
      result.push(current)
    }
    current = new Date(current.getTime() + DAY)
  }
  return result
}

/** Calendar-day age of the last data point relative to asOf. */
export function staleDays(lastTs: string | Date | undefined, asOf: Date) {
  if (!lastTs) {
    return Infinity
  }
  return Math.floor((startOfUtcDay(asOf).getTime() - startOfUtcDay(new Date(lastTs)).getTime()) / DAY)
}

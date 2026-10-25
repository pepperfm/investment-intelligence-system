import type { PhysicalBarAssessment } from './source-policy'

/** Select periods, never "the last N good bars". Unknown dates cannot be assigned outside a window. */
export function selectResearchWindow(assessments: PhysicalBarAssessment[], options: {
  asOf: Date
  from?: Date
  after?: Date
  limit?: number
}) {
  const validDate = (date: string) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date
  const issues = assessments.some(row => !validDate(row.date)) ? ['invalid_source_period_unassignable'] : []
  let selected = assessments.filter(a => validDate(a.date) && Date.parse(`${a.date}T00:00:00+03:00`) + 2 * 86_400_000 <= options.asOf.getTime() && (!options.from || a.date >= options.from.toISOString().slice(0, 10)) && (!options.after || a.date > options.after.toISOString().slice(0, 10)))
  const bounded = selected
  if (options.limit) {
    selected = options.after ? selected.slice(0, options.limit) : selected.slice(-options.limit)
  }
  const selectedDates = new Set(selected.map(row => row.date))
  const counts = new Map<string, number>()
  for (const row of bounded) {
    if (selectedDates.has(row.date)) {
      counts.set(row.date, (counts.get(row.date) ?? 0) + 1)
    }
  }
  if ([...counts.values()].some(count => count > 1) || selected.some((a, i) => i > 0 && a.date <= selected[i - 1]!.date)) {
    issues.push('duplicate_or_unordered_source_period')
  }
  return {
    selected,
    issues,
  }
}

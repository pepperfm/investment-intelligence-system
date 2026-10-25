import { percentageChange } from './provenance'

interface Observation {
  date: string
  value: string
  unit: string
  periodicity: string
}

/** Exact calendar lag, never adjacent-row substitution across missing months or periodicities. */
export function macroChanges(current: Observation, history: Observation[]) {
  const date = new Date(`${current.date}T00:00:00Z`)
  const monthly = current.periodicity === 'monthly'
  const month = new Date(date)
  month.setUTCMonth(month.getUTCMonth() - 1)
  const year = new Date(date)
  year.setUTCFullYear(year.getUTCFullYear() - 1)
  const find = (target: string) => history.find(row => row.date === target && row.unit === current.unit && row.periodicity === current.periodicity)
  const mom = monthly ? find(month.toISOString().slice(0, 10)) : null
  const yoy = monthly ? find(year.toISOString().slice(0, 10)) : null
  const beforeMonth = new Date(date)
  beforeMonth.setUTCMonth(beforeMonth.getUTCMonth() - 2)
  const lag2 = monthly ? find(beforeMonth.toISOString().slice(0, 10)) : null
  const values = [Number(current.value), Number(mom?.value), Number(lag2?.value)]
  return {
    trailing3MonthMean: monthly && mom && lag2 && values.every(Number.isFinite) ? values.reduce((sum, value) => sum + value, 0) / 3 : null,
    lag1MonthValue: mom?.value ?? null,
    momPct: mom && Number(mom.value) > 0 ? percentageChange(current.value, mom.value) : null,
    yoyPct: yoy && Number(yoy.value) > 0 ? percentageChange(current.value, yoy.value) : null,
    momDate: mom?.date ?? null,
    yoyDate: yoy?.date ?? null,
  }
}

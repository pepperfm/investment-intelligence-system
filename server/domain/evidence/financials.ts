import { percentageChange } from './provenance'

export type IssuerIndustry = 'bank' | 'exporter' | 'it' | 'general'

export interface ComparableFact {
  id?: string
  metricKey: string
  value?: string
  unit?: string
  periodStart: string
  periodEnd: string
  reportingStandard: string
  consolidated: boolean
  verification: string
  basis?: string
  periodKind?: string
}

export function issuerIndustry(isin: string | null | undefined, sector = ''): IssuerIndustry {
  if (isin === 'RU0009029540' || isin === 'RU0009029557' || /bank|financial/i.test(sector)) {
    return 'bank'
  }
  if (isin === 'RU0007288411' || /metal|oil|gas|material/i.test(sector)) {
    return 'exporter'
  }
  if (isin === 'RU000A107T19' || /tech|internet/i.test(sector)) {
    return 'it'
  }
  return 'general'
}

export function durationKind(start: string, end: string): 'annual' | 'quarter' | 'ytd' | 'instant' | 'other' {
  const days = (Date.parse(end) - Date.parse(start)) / 86400_000 + 1
  if (days === 1) {
    return 'instant'
  }
  if (days >= 364 && days <= 367) {
    return 'annual'
  }
  if (days >= 85 && days <= 96) {
    return 'quarter'
  }
  if (start.slice(5) === '01-01' && days > 96 && days < 364) {
    return 'ytd'
  }
  return 'other'
}

function compatible(a: ComparableFact, b: ComparableFact) {
  return a.metricKey === b.metricKey && a.reportingStandard === b.reportingStandard && a.consolidated === b.consolidated
    && (a.basis ?? 'reported') === (b.basis ?? 'reported') && a.unit === b.unit
    && (a.periodKind ?? 'duration') === (b.periodKind ?? 'duration')
}

/** Compare equal year-over-year windows only; never subtract quarterly and cumulative YTD earnings. */
export function compareFinancialFacts(facts: ComparableFact[]) {
  return facts.filter(fact => fact.value !== undefined && fact.unit).map((current) => {
    const priorYear = Number(current.periodEnd.slice(0, 4)) - 1
    const previous = facts.find(fact => compatible(current, fact)
      && fact.periodStart === `${Number(current.periodStart.slice(0, 4)) - 1}${current.periodStart.slice(4)}`
      && fact.periodEnd === `${priorYear}${current.periodEnd.slice(4)}`)
    const previousValue = previous?.value ?? null
    const meaningful = previousValue !== null && Number(previousValue) > 0
    return {
      metricKey: current.metricKey,
      currentId: current.id ?? null,
      previousId: previous?.id ?? null,
      periodStart: current.periodStart,
      periodEnd: current.periodEnd,
      periodKind: current.periodKind === 'instant' ? 'instant' : durationKind(current.periodStart, current.periodEnd),
      standard: current.reportingStandard,
      consolidated: current.consolidated,
      basis: current.basis ?? 'reported',
      unit: current.unit!,
      current: current.value!,
      previous: previousValue,
      yoyPct: meaningful ? percentageChange(current.value!, previousValue) : null,
      limitation: previous ? (meaningful ? null : 'Процент изменения не определён для нулевой/отрицательной базы') : 'Нет сопоставимого периода предыдущего года',
    }
  })
}

/** Minimal completeness by industry, without treating bank deposits as industrial debt or adjusted EBITDA as IFRS profit. */
export function financialCoverage(facts: ComparableFact[], industry: IssuerIndustry) {
  const verified = facts.filter(fact => ['manual_verified', 'machine_verified'].includes(fact.verification)
    && fact.reportingStandard !== 'BANK_REGULATORY' && (fact.basis ?? 'reported') === 'reported')
  const required = industry === 'bank'
    ? ['net_interest_income', 'net_profit', 'total_assets', 'equity', 'loans', 'deposits']
    : ['revenue', 'net_profit', 'debt', 'cash']
  const incomeMetric = industry === 'bank' ? 'net_interest_income' : 'revenue'
  const periods = verified.filter(fact => fact.metricKey === incomeMetric && ['annual', 'quarter', 'ytd'].includes(durationKind(fact.periodStart, fact.periodEnd)))
  const complete = periods.filter(period => required.every(metric => verified.some(fact => fact.metricKey === metric
    && fact.reportingStandard === period.reportingStandard && fact.consolidated === period.consolidated
    && fact.periodEnd === period.periodEnd
    && (fact.unit === period.unit || !fact.unit || !period.unit)
    && ((fact.periodKind === 'instant' || ['cash', 'debt', 'total_assets', 'equity', 'loans', 'deposits'].includes(metric)) || fact.periodStart === period.periodStart))))
  const covered = complete.some(period => complete.some(other => other !== period && other.reportingStandard === period.reportingStandard
    && other.consolidated === period.consolidated && other.unit === period.unit
    && Number(other.periodEnd.slice(0, 4)) === Number(period.periodEnd.slice(0, 4)) - 1
    && other.periodStart.slice(4) === period.periodStart.slice(4) && other.periodEnd.slice(4) === period.periodEnd.slice(4)))
  return {
    covered,
    industry,
    required,
    completePeriods: complete.length,
  }
}

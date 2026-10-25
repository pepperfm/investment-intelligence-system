import { COVERAGE_GAP_STATUSES, EVIDENCE_SOURCE_KEYS } from '../../../shared/types/evidence'
import type { CoverageGap, EvidenceCoverage } from '../../../shared/types/evidence'
import type { EntryScenario, ExitScenario, EvidenceItem, SourceRef } from '../../../shared/types/investment'
import { criticOutputSchema } from '../../../shared/schemas/investment'
import type { CriticOutput, AnalystOutput } from '../../../shared/schemas/investment'
import { staleDays, type CalendarOptions } from '../market/calendar'

export interface ValidationInput {
  calendar?: CalendarOptions
  strategy?: string
  coverage?: EvidenceCoverage
  draft: AnalystOutput
  entry: EntryScenario
  exit: ExitScenario
  sources: SourceRef[]
  lastCandleTs: string | undefined
  asOf: Date
  maxStaleDays: number
  rewardRisk: number | null
  /** From the strategy version (default 1.2). */
  minRewardRisk: number
}

/** Code-level checks that never depend on LLM honesty. */
export function validateHypothesis(input: ValidationInput) {
  const issues: string[] = []
  const known = new Set(input.sources.map(s => s.id))
  const evidence: EvidenceItem[] = [...input.draft.supportingEvidence, ...input.draft.counterEvidence]
  if (input.draft.priceForecast) {
    evidence.push({
      claim: input.draft.priceForecast.rationale,
      sourceIds: input.draft.priceForecast.sourceIds,
    })
    if (input.draft.priceForecast.windowTradingDays !== input.exit.timeExitDays) {
      issues.push('Окно прогноза не совпадает с замороженным горизонтом сценария')
    }
  }
  issues.push(...validateCoverageGaps(input.draft.coverageGaps ?? [], input.asOf))
  issues.push(...validateSourceAvailability(input.sources, input.asOf))
  const unknown = new Set(evidence.flatMap(e => e.sourceIds).filter(id => !known.has(id)))
  if (unknown.size) {
    issues.push(`Ссылки на несуществующие источники: ${[...unknown].join(', ')}`)
  }
  const uncited = evidence.filter(e => e.sourceIds.length === 0).length
  if (uncited) {
    issues.push(`Утверждений без источников: ${uncited}`)
  }
  if (input.draft.direction === 'long') {
    if (input.strategy === 'position' && (!input.coverage?.issuerFundamentals || !input.coverage.macro)) {
      issues.push('Position: недостаточно проверенной отчётности или макроконтекста для фундаментальной гипотезы')
    }
    const financialClaims = input.draft.supportingEvidence.filter(item => /выручк|ebitda|чист\S* прибыл|долгов\S* нагруз|денежн\S* поток|net debt/i.test(item.claim))
    const verifiedFinancialSources = new Set(input.sources.filter(source => source.kind === 'report' && (source.verification === 'manual_verified' || source.verification === 'machine_verified')).map(source => source.id))
    if (financialClaims.some(item => !item.sourceIds.some(id => verifiedFinancialSources.has(id)))) {
      issues.push('Фундаментальные аргументы требуют ссылки на подтверждённый первичный документ')
    }
    if (input.draft.supportingEvidence.length === 0) {
      issues.push('Нет подтверждающих аргументов')
    }
    if (!(input.exit.stopLoss < input.entry.price && input.entry.price < input.exit.takeProfit)) {
      issues.push('Уровни несогласованы: требуется стоп < вход < цель')
    }
    if (input.rewardRisk !== null && input.rewardRisk + 1e-9 < input.minRewardRisk) {
      issues.push(`Соотношение прибыль/риск ${input.rewardRisk.toFixed(2)} < ${input.minRewardRisk} (минимум версии правил)`)
    }
  }
  if (input.draft.counterEvidence.length === 0) {
    issues.push('Не приведено ни одного контраргумента')
  }
  const age = staleDays(input.lastCandleTs, input.asOf, input.calendar)
  if (age > input.maxStaleDays) {
    issues.push(`Котировки устарели: последние данные ${age === Infinity ? 'отсутствуют' : `${age} дн. назад`}`)
  }
  return {
    ok: issues.length === 0,
    issues,
  }
}

/** Deterministic checks prove provenance/shape, never the truth of free-form prose. */
export function validateCoverageGaps(gaps: CoverageGap[], asOf: Date): string[] {
  const issues: string[] = []
  for (const gap of gaps) {
    if (!EVIDENCE_SOURCE_KEYS.includes(gap.sourceKey) || !COVERAGE_GAP_STATUSES.includes(gap.status)) {
      issues.push(`Неизвестный реестр или статус пробела: ${gap.sourceKey}`)
    }
    if (new Date(gap.asOf).getTime() !== asOf.getTime()) {
      issues.push(`Пробел покрытия относится к другой дате: ${gap.sourceKey}`)
    }
  }
  return issues
}

function validateSourceAvailability(sources: SourceRef[], asOf: Date): string[] {
  return sources.filter(source => [source.asOf, source.availableAt, source.publishedAt]
    .filter((value): value is string => !!value)
    .some(value => !Number.isFinite(Date.parse(value)) || Date.parse(value) > asOf.getTime()))
    .map(source => `Источник недоступен на дату анализа: ${source.id}`)
}

/** Called after the critic provider: malformed/unknown citations must never establish supported. */
export function validateCriticOutput(output: unknown, sources: SourceRef[], asOf: Date, priceForecast: AnalystOutput['priceForecast'] = null) {
  const parsed = criticOutputSchema.safeParse(output)
  if (!parsed.success) {
    return {
      ok: false,
      issues: ['Невалидный контракт критика'],
      output: null,
    }
  }
  const critic: CriticOutput = parsed.data
  const known = new Set(sources.map(source => source.id))
  const unknown = [...new Set(critic.findings.flatMap(finding => finding.sourceIds).filter(id => !known.has(id)))]
  const issues = [
    ...unknown.map(id => `Ссылка критика на несуществующий источник: ${id}`),
    ...validateCoverageGaps(critic.coverageGaps, asOf),
    ...validateSourceAvailability(sources, asOf),
  ]
  if ((!priceForecast && critic.forecastVerdict !== 'not_applicable') || (priceForecast && critic.forecastVerdict === 'not_applicable')) {
    issues.push('Вердикт по прогнозу не соответствует наличию отдельного прогноза')
  }
  return {
    ok: issues.length === 0,
    issues,
    output: critic,
  }
}

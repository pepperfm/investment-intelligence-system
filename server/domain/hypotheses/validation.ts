import type { EvidenceCoverage } from '../../../shared/types/evidence'
import type { EntryScenario, ExitScenario, EvidenceItem, SourceRef } from '../../../shared/types/investment'
import type { AnalystOutput } from '../../../shared/schemas/investment'
import { staleDays } from '../market/calendar'

export interface ValidationInput {
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
  const age = staleDays(input.lastCandleTs, input.asOf)
  if (age > input.maxStaleDays) {
    issues.push(`Котировки устарели: последние данные ${age === Infinity ? 'отсутствуют' : `${age} дн. назад`}`)
  }
  return {
    ok: issues.length === 0,
    issues,
  }
}

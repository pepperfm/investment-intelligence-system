import type { EvidenceCoverage } from '../../../shared/types/evidence'
import { financialCoverage, type ComparableFact, type IssuerIndustry } from './financials'

export function evidenceCoverage(macroCount: number, facts: ComparableFact[], regulatoryCount: number, industry: IssuerIndustry = 'general'): EvidenceCoverage {
  const coverage = financialCoverage(facts, industry)
  const missing: string[] = []
  if (!macroCount) {
    missing.push('Нет свежего доступного на дату анализа макроконтекста')
  }
  if (!coverage.covered) {
    missing.push(`Нет двух сопоставимых периодов проверенной отчётности (${industry}): ${coverage.required.join(', ')}; банковские формы отдельного юрлица и non-IFRS не заменяют МСФО группы`)
  }
  if (!regulatoryCount) {
    missing.push('Регуляторные события не покрыты на дату анализа; это не означает отсутствия событий')
  }
  return {
    macro: macroCount > 0,
    issuerFundamentals: coverage.covered,
    regulatoryEvents: regulatoryCount > 0,
    missing,
  }
}

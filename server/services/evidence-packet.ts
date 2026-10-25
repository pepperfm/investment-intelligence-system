import { issuerIndustry, compareFinancialFacts } from '../domain/evidence/financials'
import { regulatoryLinks } from '../domain/evidence/event-links'
import { bankEvidence } from './bank-evidence'
import { db, schema } from '@nuxthub/db'
import { desc, lte, eq } from 'drizzle-orm'
import type { EvidenceSourceHealth, CoverageGap, EvidenceSourceKey } from '../../shared/types/evidence'
import { SOURCE_DEFINITIONS } from './source-status'
import type { SourceRef } from '../../shared/types/investment'
import { macroOverview, regulatoryHistory } from './macro'
import { loadIssuerFacts } from './issuer-fundamentals'
import { evidenceCoverage } from '../domain/evidence/completeness'
import { sourceHealth as freshnessStatus } from '../domain/evidence/provenance'

export async function loadEvidenceContext(instrumentId: string, asOf: Date) {
  const [macro, facts, regulatory] = await Promise.all([macroOverview(asOf), loadIssuerFacts(instrumentId, asOf), regulatoryHistory(asOf, 15)])
  // Durable registry state can be newer than asOf; never backdate current health into a historical run.
  const registry = await db.select().from(schema.dataSources)
  const fetches = await db.select({
    sourceId: schema.sourceFetches.sourceId,
    completedAt: schema.sourceFetches.completedAt,
    errorCode: schema.sourceFetches.errorCode,
  }).from(schema.sourceFetches).where(lte(schema.sourceFetches.completedAt, asOf)).orderBy(desc(schema.sourceFetches.completedAt)).limit(1000)
  const sourceHealth: EvidenceSourceHealth[] = SOURCE_DEFINITIONS.map((definition) => {
    const latest = fetches.find(row => row.sourceId === definition.id)
    const current = registry.find(row => row.id === definition.id)
    if (current?.lastAttemptAt && current.lastAttemptAt <= asOf) {
      return {
        sourceId: definition.id,
        status: freshnessStatus(current.status, current.lastSuccessAt, asOf, definition.id === 'cbr_statistics' ? 24 * 35 : 72),
        lastAttemptAt: current.lastAttemptAt.toISOString(),
        lastSuccessAt: current.lastSuccessAt?.toISOString() ?? null,
        errorCode: current.lastErrorCode,
        coverage: [...definition.coverage],
      }
    }
    return {
      sourceId: definition.id,
      status: latest?.errorCode ? 'unavailable' : 'not_covered',
      lastAttemptAt: latest?.completedAt.toISOString() ?? null,
      lastSuccessAt: null,
      errorCode: latest?.errorCode ?? null,
      coverage: [...definition.coverage],
    }
  })
  const [instrument] = await db.select().from(schema.instruments).where(eq(schema.instruments.id, instrumentId))
  const industry = issuerIndustry(instrument?.isin, instrument?.sector)
  const bank = await bankEvidence(instrumentId, asOf)
  const linkedRegulatory = regulatory.map(row => ({
    ...row,
    links: regulatoryLinks(row, bank.regulatory
      ? [{
          inn: bank.regulatory.inn,
          names: [bank.regulatory.name],
        }]
      : []),
  }))
  const sources: SourceRef[] = [
    ...bank.reports.map(row => ({
      id: `bank:${row.id}`,
      kind: 'report' as const,
      title: `Форма ${row.form} · ${row.reportDate} · отдельное юрлицо`,
      url: row.provenance.sourceUrl,
      asOf: row.availableAt.toISOString(),
      ...row.provenance,
    })),
    ...(bank.regulatory
      ? [{
          id: `license:${bank.regulatory.ogrn}`,
          kind: 'regulatory' as const,
          title: 'FinOrg · реквизиты и права деятельности организации',
          url: bank.regulatory.provenance.sourceUrl,
          asOf: bank.regulatory.provenance.availableAt!,
          ...bank.regulatory.provenance,
        }]
      : []),
    ...macro.map(row => ({
      id: `macro:${row.id}`,
      kind: 'macro' as const,
      title: `${row.label}: ${row.value} ${row.unit} (${row.date})`,
      url: row.provenance.sourceUrl,
      asOf: row.provenance.availableAt!,
      ...row.provenance,
    })),
    ...facts.map(row => ({
      id: `fact:${row.id}`,
      kind: 'report' as const,
      title: `${row.title} · ${row.metricKey} (${row.locator})`,
      url: row.sourceUrl,
      asOf: row.availableAt.toISOString(),
      sourceId: 'issuer_disclosure',
      publishedAt: row.publishedAt?.toISOString() ?? null,
      availableAt: row.availableAt.toISOString(),
      observedAt: row.availableAt.toISOString(),
      contentHash: row.contentHash,
      verification: row.verification as 'manual_verified' | 'machine_verified',
    })),
    ...regulatory.map(row => ({
      id: `reg:${row.id}`,
      kind: 'regulatory' as const,
      title: row.title,
      url: row.provenance.sourceUrl,
      asOf: row.availableAt.toISOString(),
      ...row.provenance,
    })),
  ]
  const freshRates = macro.filter(row => row.seriesKey === 'cbr.key_rate'
    && asOf.getTime() - Date.parse(row.provenance.observedAt) <= 72 * 3600_000
    && asOf.getTime() - Date.parse(row.date) <= 7 * 86400_000)
  const recentFacts = facts.filter(fact => asOf.getTime() - Date.parse(fact.periodEnd) <= 3 * 365 * 86400_000)
  const coverageGaps: CoverageGap[] = sourceHealth.filter(source => source.status !== 'ok').map((source) => {
    const current = registry.find(row => row.id === source.sourceId)
    const observedLater = !source.lastAttemptAt && !!current?.lastAttemptAt && current.lastAttemptAt > asOf
    let status: CoverageGap['status'] = 'not_covered'
    if (observedLater) {
      status = 'not_yet_observed'
    } else if (source.status === 'stale' || source.status === 'unavailable') {
      status = source.status
    }
    return {
      sourceKey: source.sourceId as EvidenceSourceKey,
      status,
      reason: observedLater ? 'На дату анализа источник ещё не наблюдался системой' : `Состояние источника на дату: ${source.status}`,
      impact: 'Отсутствие покрытия не доказывает отсутствие событий или рисков',
      asOf: asOf.toISOString(),
    }
  })
  if (!facts.length && !coverageGaps.some(gap => gap.sourceKey === 'issuer_disclosure')) {
    coverageGaps.push({
      sourceKey: 'issuer_disclosure',
      status: 'not_covered',
      reason: 'Нет доступных фактов по этому эмитенту',
      impact: 'Нельзя обосновать фундаментальные числовые утверждения',
      asOf: asOf.toISOString(),
    })
  }
  return {
    coverageGaps,
    sourceHealth,
    macroContext: macro.map(({ history: _history, ...row }) => row),
    issuerFundamentals: facts,
    issuerIndustry: industry,
    financialComparisons: compareFinancialFacts(facts),
    bankContext: {
      reports: bank.reports.map(row => ({
        ...row,
        rows: row.rows.slice(0, 12),
        note: 'Сокращённый контекст; полная форма хранится отдельно. Формы ЦБ не равны консолидированной МСФО.',
      })),
      regulatory: bank.regulatory,
    },
    regulatoryEvents: linkedRegulatory,
    evidenceCoverage: evidenceCoverage(freshRates.length, recentFacts, regulatory.length, industry),
    sources,
  }
}

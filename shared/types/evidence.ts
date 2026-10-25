export type SourceStatus = 'ok' | 'stale' | 'unavailable' | 'not_covered' | 'blocked'
export type Verification = 'official_observed' | 'machine_verified' | 'manual_verified' | 'aggregated_unverified'

export interface EvidenceProvenance {
  sourceId: string
  sourceUrl: string
  externalId: string
  contentHash: string
  publishedAt: string | null
  observedAt: string
  availableAt: string | null
  effectiveAt?: string
  historicalAvailability: 'observed_only' | 'verified_publication'
  verification: Verification
}

export interface MacroObservation {
  seriesKey: string
  label: string
  date: string
  value: string
  unit: string
  periodicity: 'daily' | 'monthly'
  provenance: EvidenceProvenance
}

export interface RegulatoryEvent {
  title: string
  body: string
  category: 'monetary_policy' | 'banking_regulation' | 'financial_market' | 'other'
  provenance: EvidenceProvenance
}

export interface EvidenceCoverage {
  macro: boolean
  issuerFundamentals: boolean
  regulatoryEvents: boolean
  missing: string[]
}

export interface EvidenceContext {
  macroContext: {
    id: string
    seriesKey: string
    label: string
    date: string
    value: string
    unit: string
    periodicity: string
    provenance: EvidenceProvenance
  }[]
  issuerFundamentals: {
    id: string
    documentId: string
    issuerId: string
    title: string
    reportingStandard: string
    consolidated: boolean
    periodStart: string
    periodEnd: string
    publishedAt: Date | string | null
    availableAt: Date | string
    sourceUrl: string
    contentHash: string
    verification: string
    metricKey: string
    value: string
    unit: string
    originalUnit: string
    locator: string
  }[]
  regulatoryEvents: {
    id: string
    title: string
    body: string
    category: string
    publishedAt: Date | string | null
    availableAt: Date | string
    provenance: EvidenceProvenance
  }[]
}

export interface EvidenceSourceHealth {
  sourceId: string
  status: SourceStatus
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  errorCode: string | null
  coverage: string[]
}

export interface BankFormSnapshot {
  form: 101 | 102
  regNum: string
  reportDate: string
  standard: 'BANK_REGULATORY'
  consolidated: false
  unit: string | null
  rows: Record<string, string>[]
  provenance: EvidenceProvenance
}

export interface RegulatoryIdentitySnapshot {
  inn: string
  ogrn: string
  name: string
  regNum: string | null
  status: 'Active' | 'NotActive' | null
  bankStatus: string | null
  licenses: {
    activity: string
    number: string | null
    name: string
    startDate: string | null
    endDate: string | null
  }[]
  provenance: EvidenceProvenance
}

/** Registry identifiers describe coverage, never an individual evidence citation. */
export const EVIDENCE_SOURCE_KEYS = ['cbr_daily', 'cbr_statistics', 'cbr_news', 'cbr_banks', 'cbr_finorg', 'issuer_disclosure', 'finam_news_rss', 'smartlab_ifrs'] as const
export type EvidenceSourceKey = typeof EVIDENCE_SOURCE_KEYS[number]
export const COVERAGE_GAP_STATUSES = ['not_covered', 'unavailable', 'stale', 'not_yet_observed', 'not_applicable'] as const
export interface CoverageGap {
  sourceKey: EvidenceSourceKey
  status: typeof COVERAGE_GAP_STATUSES[number]
  reason: string
  impact: string
  asOf: string
}

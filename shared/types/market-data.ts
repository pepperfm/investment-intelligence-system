import type { Candle } from './investment'

export interface ResearchBarSelection {
  provider: 'finam' | 'mock' | 'moex_iss'
  policyId: 'legacy_daily' | 'mock_daily' | 'physical_session_v1'
  /** Freeze the immutable source revision visible when the run was queued. */
  revisionCutoff: string
  auditIds?: Record<string, string | null>
  inputSetVersion: string
}
export interface ResearchProvenance {
  selection: ResearchBarSelection
  source: string
  board: string
  market: string
  instrument: string
  sourceRevision: string
  calendarVersion: string
  barPolicy: string
  historicalAvailability: 'verified' | 'unknown'
  reconstruction: boolean
  adjustmentPolicy: string
  confirmedSessionAge?: number | null
  coverage?: {
    from: string
    to: string
    observedAt: string
    hash: string
  }
  observedAt: string | null
  inputHash: string
}
export interface ResearchQuality {
  status: 'verified' | 'research_usable_with_limits' | 'data_quality_blocked'
  issues: string[]
  calendarVersion: string
  normalizationVersion: string
  contractVersion: string | null
  completedBars: Candle[]
}

import type { EvidenceProvenance, SourceStatus } from '../../../shared/types/evidence'

/** Unknown availability is excluded; publication and effective dates are independent. */
export function availableAsOf(provenance: Pick<EvidenceProvenance, 'availableAt' | 'publishedAt' | 'observedAt'>, asOf: Date) {
  const cutoff = asOf.getTime()
  const dates = [provenance.availableAt, provenance.observedAt]
  if (provenance.publishedAt !== null) {
    dates.push(provenance.publishedAt)
  }
  return dates.every(value => value !== null && Number.isFinite(Date.parse(value)) && Date.parse(value) <= cutoff)
}

export function sourceHealth(status: SourceStatus, lastSuccessAt: Date | null, now: Date, maxAgeHours: number): SourceStatus {
  if (status === 'ok' && (!lastSuccessAt || now.getTime() - lastSuccessAt.getTime() > maxAgeHours * 3600_000)) {
    return 'stale'
  }
  return status
}

/** Decimal strings are stored unchanged in numeric SQL columns; never turn missing into zero. */
export function decimalValue(value: string): string {
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.')
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized) || normalized.length > 40) {
    throw new Error('Invalid decimal value')
  }
  return normalized
}

export function percentageChange(current: string | null, previous: string | null): number | null {
  if (current === null || previous === null) {
    return null
  }
  const denominator = Number(decimalValue(previous))
  return denominator === 0 ? null : (Number(decimalValue(current)) / denominator - 1) * 100
}

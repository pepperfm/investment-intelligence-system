import type { Candle } from '../../../shared/types/investment'
import { calendarVersion, isTradingDay } from './calendar'

export const BAR_NORMALIZATION_VERSION = 'trading-day-v1'

/** Only an independently verified adapter can supply this contract. Legacy stored rows cannot. */
export interface VerifiedDailyBarContract {
  model: 'trading_day'
  timestampMeaning: 'trading_date'
  version: string
  verified: true
  adjustmentPolicy: string
  evidenceUrls: string[]
  completedAtByTradingDate: Record<string, string>
  availableAtByTradingDate: Record<string, string>
}

export interface BarQualityOptions {
  dataSource: 'finam' | 'mock'
  board?: string
  asOf: Date
  contract?: VerifiedDailyBarContract
}

/** Validate rather than merge ambiguous daily/session bars. A blocked series never enters calculations. */
export function inspectBarQuality(candles: Candle[], options: BarQualityOptions) {
  const policy = {
    provider: options.dataSource,
    board: options.board,
    asOf: options.asOf,
  }
  const issues: string[] = []
  const completedBars: Candle[] = []
  const contract = options.contract
  if (!Number.isFinite(options.asOf.getTime())) {
    issues.push('invalid_as_of')
  }
  if (options.dataSource === 'finam' && (!contract?.verified || contract.model !== 'trading_day'
    || contract.timestampMeaning !== 'trading_date' || !contract.version || !contract.adjustmentPolicy
    || !contract.evidenceUrls.length)) {
    issues.push('finam_daily_contract_unverified: timestamp meaning, session overlap and completion are not established')
  }
  if (!candles.length) {
    issues.push('missing_candles')
  }
  const seen = new Set<string>()
  let previous = ''
  for (const candle of candles) {
    const instant = new Date(candle.ts)
    if (!Number.isFinite(instant.getTime())) {
      issues.push('invalid_bar_timestamp')
      continue
    }
    const date = instant.toISOString().slice(0, 10)
    if (seen.has(date)) {
      issues.push(`duplicate_trading_period:${date}`)
    }
    if (previous && date < previous) {
      issues.push(`unordered_trading_period:${date}`)
    }
    seen.add(date)
    previous = date
    if (![candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite)
      || Math.min(candle.open, candle.high, candle.low, candle.close) <= 0 || candle.volume < 0
      || candle.low > Math.min(candle.open, candle.close) || candle.high < Math.max(candle.open, candle.close)) {
      issues.push(`invalid_ohlcv:${date}`)
    }
    try {
      if (!isTradingDay(instant, policy)) {
        issues.push(`non_regular_trading_date:${date}`)
      }
    } catch {
      issues.push(`calendar_unverified:${date}`)
    }
    // Mock is a separate declared synthetic model, not evidence about Finam completion.
    const completedAt = options.dataSource === 'mock'
      ? new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString()
      : contract?.completedAtByTradingDate[date]
    const availableAt = options.dataSource === 'mock' ? completedAt : contract?.availableAtByTradingDate[date]
    if (!completedAt || !availableAt || !Number.isFinite(Date.parse(completedAt)) || !Number.isFinite(Date.parse(availableAt))) {
      issues.push(`completion_or_availability_unknown:${date}`)
      continue
    }
    if (Date.parse(availableAt) < Date.parse(completedAt)) {
      issues.push(`availability_precedes_completion:${date}`)
      continue
    }
    if (Date.parse(completedAt) <= options.asOf.getTime() && Date.parse(availableAt) <= options.asOf.getTime()) {
      completedBars.push(candle)
    }
  }
  const uniqueIssues = [...new Set(issues)]
  return {
    status: uniqueIssues.length ? 'data_quality_blocked' as const : 'verified' as const,
    calendarVersion: calendarVersion(policy),
    normalizationVersion: options.dataSource === 'mock' ? 'mock-completed-daily-v1' : BAR_NORMALIZATION_VERSION,
    contractVersion: contract?.version ?? null,
    issues: uniqueIssues,
    completedBars: uniqueIssues.length ? [] : completedBars,
  }
}

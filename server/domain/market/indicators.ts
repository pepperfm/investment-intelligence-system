import type { Candle } from '../../../shared/types/investment'

export function sma(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) {
    return null
  }
  let sum = 0
  for (let i = values.length - period; i < values.length; i++) {
    sum += values[i]!
  }
  return sum / period
}

export function ema(values: number[], period: number): number | null {
  if (values.length < period) {
    return null
  }
  const k = 2 / (period + 1)
  let value = sma(values.slice(0, period), period)!
  for (let i = period; i < values.length; i++) {
    value = values[i]! * k + value * (1 - k)
  }
  return value
}

/** Wilder RSI. */
export function rsi(values: number[], period = 14): number | null {
  if (values.length <= period) {
    return null
  }
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const diff = values[i]! - values[i - 1]!
    gain += Math.max(diff, 0)
    loss += Math.max(-diff, 0)
  }
  gain /= period
  loss /= period
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i]! - values[i - 1]!
    gain = (gain * (period - 1) + Math.max(diff, 0)) / period
    loss = (loss * (period - 1) + Math.max(-diff, 0)) / period
  }
  if (loss === 0) {
    return 100
  }
  return 100 - 100 / (1 + gain / loss)
}

/** Wilder ATR. */
export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length <= period) {
    return null
  }
  const ranges: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!
    const prev = candles[i - 1]!.close
    ranges.push(Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev)))
  }
  let value = ranges.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < ranges.length; i++) {
    value = (value * (period - 1) + ranges[i]!) / period
  }
  return value
}

/** Annualised volatility of daily log returns. */
export function volatility(values: number[], lookback = 60): number | null {
  if (values.length < lookback + 1) {
    return null
  }
  const slice = values.slice(-lookback - 1)
  const returns = slice.slice(1).map((v, i) => Math.log(v / slice[i]!))
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1)
  return Math.sqrt(variance) * Math.sqrt(252)
}

export function momentum(values: number[], lookback: number): number | null {
  if (values.length <= lookback) {
    return null
  }
  return values.at(-1)! / values.at(-1 - lookback)! - 1
}

/** Average daily turnover (price × volume) in instrument currency. */
export function avgTurnover(candles: Candle[], lookback = 20): number | null {
  if (candles.length < lookback) {
    return null
  }
  const slice = candles.slice(-lookback)
  return slice.reduce((sum, c) => sum + c.close * c.volume, 0) / lookback
}

export function highest(candles: Candle[], lookback: number, excludeLast = true): number | null {
  const end = excludeLast ? candles.length - 1 : candles.length
  if (end < lookback) {
    return null
  }
  let value = -Infinity
  for (let i = end - lookback; i < end; i++) {
    value = Math.max(value, candles[i]!.high)
  }
  return value
}

export function maxDrawdown(values: number[]): number {
  let peak = -Infinity
  let worst = 0
  for (const v of values) {
    peak = Math.max(peak, v)
    worst = Math.min(worst, v / peak - 1)
  }
  return worst
}

export interface MarketMetrics {
  [key: string]: number | null
  close: number | null
  sma20: number | null
  sma50: number | null
  sma200: number | null
  ema20: number | null
  rsi14: number | null
  atr14: number | null
  atrPct: number | null
  volatility60: number | null
  momentum20: number | null
  momentum60: number | null
  momentum120: number | null
  high20: number | null
  high55: number | null
  avgTurnover20: number | null
  drawdown250: number | null
  bars: number
}

export function computeMetrics(candles: Candle[]): MarketMetrics {
  const closes = candles.map(c => c.close)
  const close = closes.at(-1) ?? null
  const atr14 = atr(candles, 14)
  return {
    close,
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    ema20: ema(closes, 20),
    rsi14: rsi(closes, 14),
    atr14,
    atrPct: atr14 !== null && close ? atr14 / close : null,
    volatility60: volatility(closes, 60),
    momentum20: momentum(closes, 20),
    momentum60: momentum(closes, 60),
    momentum120: momentum(closes, 120),
    high20: highest(candles, 20),
    high55: highest(candles, 55),
    avgTurnover20: avgTurnover(candles, 20),
    drawdown250: closes.length ? maxDrawdown(closes.slice(-250)) : null,
    bars: candles.length,
  }
}

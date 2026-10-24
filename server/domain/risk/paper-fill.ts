import type { Candle, CostModel } from '../../../shared/types/investment'

/** Daily bars cannot prove fills during the confirmation day. Use later bars only. */
export function paperFill(order: {
  side: 'buy' | 'sell'
  type: 'market' | 'limit'
  limitPrice: number | null
  confirmedAt: Date
}, candles: Candle[], costs: CostModel) {
  const future = candles.filter(c => new Date(c.ts) > order.confirmedAt)
  if (order.type === 'market') {
    const bar = future[0]
    if (!bar) {
      return null
    }
    const sign = order.side === 'buy' ? 1 : -1
    return {
      price: bar.open * (1 + sign * (costs.slippagePct + costs.spreadPct / 2) / 100),
      executedAt: new Date(bar.ts),
    }
  }
  if (order.limitPrice === null) {
    return null
  }
  const limit = order.limitPrice
  const bar = future.find(c => order.side === 'buy' ? c.low <= limit : c.high >= limit)
  if (!bar) {
    return null
  }
  return {
    price: order.side === 'buy' ? Math.min(bar.open, limit) : Math.max(bar.open, limit),
    executedAt: new Date(bar.ts),
  }
}

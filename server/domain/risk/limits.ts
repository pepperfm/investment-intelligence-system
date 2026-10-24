import type { CostModel, RiskCheckResult, RiskLimits } from '../../../shared/types/investment'

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxPositionPct: 10,
  maxRiskPerTradePct: 1,
  maxTotalExposurePct: 80,
  maxSectorPct: 30,
  maxDailyLossPct: 2,
  maxAdvParticipationPct: 1,
  minAvgTurnover: 30_000_000,
  allowLeverage: false,
}

export const DEFAULT_COSTS: CostModel = {
  commissionPct: 0.05,
  spreadPct: 0.05,
  slippagePct: 0.1,
}

export interface PortfolioState {
  equity: number
  cash: number
  /** Market value by instrument id. */
  positions: Record<string, {
    value: number
    sector: string
    quantity: number
  }>
  /** Equity at the start of the current trading day; null if unknown. */
  dayStartEquity: number | null
}

export interface SizingInput {
  equity: number
  entry: number
  stopLoss: number
  lotSize: number
  avgTurnover: number | null
  limits: RiskLimits
}

/** Largest whole-lot quantity satisfying per-trade risk, position size and ADV participation. */
export function suggestQuantity({ equity, entry, stopLoss, lotSize, avgTurnover, limits }: SizingInput) {
  const perShareRisk = entry - stopLoss
  if (perShareRisk <= 0 || entry <= 0 || equity <= 0) {
    return 0
  }
  const byRisk = (equity * limits.maxRiskPerTradePct / 100) / perShareRisk
  const bySize = (equity * limits.maxPositionPct / 100) / entry
  const byLiquidity = avgTurnover ? (avgTurnover * limits.maxAdvParticipationPct / 100) / entry : Infinity
  const shares = Math.min(byRisk, bySize, byLiquidity)
  return Math.max(0, Math.floor(shares / lotSize) * lotSize)
}

export interface OrderRiskInput {
  side: 'buy' | 'sell'
  instrumentId: string
  sector: string
  quantity: number
  lotSize: number
  price: number
  stopLoss: number | null
  avgTurnover: number | null
  portfolio: PortfolioState
  limits: RiskLimits
  costs: CostModel
}

/** Code-level risk gate executed before an order may even be offered for confirmation. */
export function checkOrderRisk(input: OrderRiskInput): RiskCheckResult {
  const { side, quantity, lotSize, price, portfolio, limits, costs } = input
  const violations: string[] = []
  const warnings: string[] = []
  const notional = quantity * price
  const commission = notional * costs.commissionPct / 100
  const held = portfolio.positions[input.instrumentId]
  if (quantity % lotSize !== 0) {
    violations.push(`Количество должно быть кратно лоту (${lotSize})`)
  }
  if (side === 'sell') {
    if (!held || held.quantity < quantity) {
      violations.push('Короткие продажи запрещены: продаваемое количество больше позиции')
    }
    return {
      ok: violations.length === 0,
      violations,
      warnings,
      notional,
      riskAmount: 0,
      exposureAfterPct: exposurePct(portfolio, -notional),
      sectorAfterPct: sectorPct(portfolio, input.sector, -notional),
    }
  }
  if (notional + commission > portfolio.cash) {
    violations.push('Недостаточно денежных средств; кредитное плечо запрещено')
  }
  const positionAfter = (held?.value ?? 0) + notional
  if (positionAfter / portfolio.equity * 100 > limits.maxPositionPct) {
    violations.push(`Размер позиции ${(positionAfter / portfolio.equity * 100).toFixed(1)}% > лимита ${limits.maxPositionPct}%`)
  }
  let riskAmount = 0
  if (input.stopLoss !== null && price <= input.stopLoss) {
    violations.push(`Цена ${price} не выше стоп-лосса ${input.stopLoss}: условие опровержения уже выполнено`)
  }
  if (input.stopLoss === null) {
    warnings.push('Не задан стоп-лосс: риск сделки не ограничен')
  } else {
    riskAmount = quantity * Math.max(price - input.stopLoss, 0)
    if (riskAmount / portfolio.equity * 100 > limits.maxRiskPerTradePct) {
      violations.push(`Риск сделки ${(riskAmount / portfolio.equity * 100).toFixed(2)}% > лимита ${limits.maxRiskPerTradePct}%`)
    }
  }
  const exposureAfterPct = exposurePct(portfolio, notional)
  if (exposureAfterPct > limits.maxTotalExposurePct) {
    violations.push(`Суммарная экспозиция ${exposureAfterPct.toFixed(1)}% > лимита ${limits.maxTotalExposurePct}%`)
  }
  const sectorAfterPct = sectorPct(portfolio, input.sector, notional)
  if (sectorAfterPct > limits.maxSectorPct) {
    violations.push(`Концентрация в секторе «${input.sector}» ${sectorAfterPct.toFixed(1)}% > лимита ${limits.maxSectorPct}%`)
  }
  if (input.avgTurnover === null) {
    warnings.push('Нет данных о ликвидности')
  } else {
    if (input.avgTurnover < limits.minAvgTurnover) {
      violations.push('Средний дневной оборот ниже минимально допустимого')
    }
    if (notional / input.avgTurnover * 100 > limits.maxAdvParticipationPct) {
      violations.push(`Заявка ${(notional / input.avgTurnover * 100).toFixed(2)}% от дневного оборота > ${limits.maxAdvParticipationPct}%`)
    }
  }
  if (portfolio.dayStartEquity !== null) {
    const dayLossPct = (portfolio.dayStartEquity - portfolio.equity) / portfolio.dayStartEquity * 100
    if (dayLossPct >= limits.maxDailyLossPct) {
      violations.push(`Дневной убыток ${dayLossPct.toFixed(2)}% достиг лимита ${limits.maxDailyLossPct}%: новые покупки заблокированы`)
    }
  }
  return {
    ok: violations.length === 0,
    violations,
    warnings,
    notional,
    riskAmount,
    exposureAfterPct,
    sectorAfterPct,
  }
}

function exposurePct(portfolio: PortfolioState, delta: number) {
  const invested = Object.values(portfolio.positions).reduce((sum, p) => sum + p.value, 0)
  return Math.max(invested + delta, 0) / portfolio.equity * 100
}

function sectorPct(portfolio: PortfolioState, sector: string, delta: number) {
  const value = Object.values(portfolio.positions).filter(p => p.sector === sector).reduce((sum, p) => sum + p.value, 0)
  return Math.max(value + delta, 0) / portfolio.equity * 100
}

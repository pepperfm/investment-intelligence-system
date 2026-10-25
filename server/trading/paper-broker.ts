import { db, schema } from '@nuxthub/db'
import { and, asc, desc, eq, gt, lt } from 'drizzle-orm'
import type { PositionSnapshot } from '../../shared/types/investment'
import { addTradingDays, startOfUtcDay } from '../domain/market/calendar'
import { checkOrderRisk, suggestQuantity, type PortfolioState } from '../domain/risk/limits'
import { inspectBarQuality } from '../domain/market/bar-quality'
import { paperFill } from '../domain/risk/paper-fill'
import { avgTurnover } from '../domain/market/indicators'
import { getInstrument, lastClose, loadCandles } from '../services/market'
import { getCostModel, getRiskLimits } from '../services/settings'

const PAPER_INITIAL_CASH = 1_000_000
type TradingReader = Pick<typeof db, 'select'>

/**
 * Paper broker. This module is the only place where orders change state, it is called only from
 * authenticated UI endpoints, and agents have no path to it. No live broker is wired in.
 */
export async function paperAccount() {
  const [existing] = await db.select().from(schema.accounts).where(and(eq(schema.accounts.provider, 'paper'), eq(schema.accounts.externalId, 'default')))
  if (existing) {
    return existing
  }
  const [created] = await db.insert(schema.accounts).values({
    provider: 'paper',
    externalId: 'default',
    name: 'Paper trading',
    initialCash: PAPER_INITIAL_CASH,
    cash: PAPER_INITIAL_CASH,
  }).onConflictDoNothing().returning()
  return created ?? (await db.select().from(schema.accounts).where(and(eq(schema.accounts.provider, 'paper'), eq(schema.accounts.externalId, 'default'))))[0]!
}

export async function positions(accountId: string, reader: TradingReader = db): Promise<(PositionSnapshot & {
  sector: string
  lotSize: number
})[]> {
  const rows = await reader.select({
    execution: schema.executions,
    symbol: schema.instruments.symbol,
    sector: schema.instruments.sector,
    lotSize: schema.instruments.lotSize,
  }).from(schema.executions).innerJoin(schema.instruments, eq(schema.instruments.id, schema.executions.instrumentId)).where(eq(schema.executions.accountId, accountId)).orderBy(asc(schema.executions.executedAt))
  const book = new Map<string, {
    symbol: string
    sector: string
    lotSize: number
    quantity: number
    cost: number
  }>()
  for (const { execution: e, symbol, sector, lotSize } of rows) {
    const p = book.get(e.instrumentId) ?? {
      symbol,
      sector,
      lotSize,
      quantity: 0,
      cost: 0,
    }
    if (e.side === 'buy') {
      p.cost += e.price * e.quantity
      p.quantity += e.quantity
    } else {
      const avg = p.quantity ? p.cost / p.quantity : 0
      p.quantity -= e.quantity
      p.cost -= avg * e.quantity
    }
    book.set(e.instrumentId, p)
  }
  const result = []
  for (const [instrumentId, p] of book) {
    if (p.quantity <= 0) {
      continue
    }
    const last = (await lastClose(instrumentId))?.close ?? p.cost / p.quantity
    result.push({
      instrumentId,
      symbol: p.symbol,
      sector: p.sector,
      lotSize: p.lotSize,
      quantity: p.quantity,
      avgPrice: p.cost / p.quantity,
      lastPrice: last,
      marketValue: last * p.quantity,
      unrealizedPnl: (last - p.cost / p.quantity) * p.quantity,
    })
  }
  return result
}

export async function portfolioState(accountId: string, reader: TradingReader = db): Promise<PortfolioState & {
  account: typeof schema.accounts.$inferSelect
  list: Awaited<ReturnType<typeof positions>>
}> {
  const [account] = await reader.select().from(schema.accounts).where(eq(schema.accounts.id, accountId))
  const list = await positions(accountId, reader)
  const equity = account!.cash + list.reduce((s, p) => s + p.marketValue, 0)
  const [dayStart] = await reader.select({ equity: schema.portfolioSnapshots.equity }).from(schema.portfolioSnapshots).where(and(eq(schema.portfolioSnapshots.accountId, accountId), lt(schema.portfolioSnapshots.takenAt, startOfUtcDay(new Date())))).orderBy(desc(schema.portfolioSnapshots.takenAt)).limit(1)
  return {
    account: account!,
    list,
    equity,
    cash: account!.cash,
    positions: Object.fromEntries(list.map(p => [p.instrumentId, {
      value: p.marketValue,
      sector: p.sector,
      quantity: p.quantity,
    }])),
    dayStartEquity: dayStart?.equity ?? null,
  }
}

export interface OrderRequest {
  hypothesisId?: string
  instrumentId: string
  side: 'buy' | 'sell'
  type: 'market' | 'limit'
  quantity: number
  limitPrice?: number
  idempotencyKey: string
}

async function assessOrder(request: Omit<OrderRequest, 'idempotencyKey'>) {
  const account = await paperAccount()
  const instrument = await getInstrument(request.instrumentId)
  if (instrument.kind !== 'equity') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Only equities can be traded',
    })
  }
  const { stopLoss, violations: hypothesisViolations } = await orderHypothesis(request)
  const last = await lastClose(request.instrumentId)
  if (!last) {
    throw createError({
      statusCode: 409,
      statusMessage: 'No market data for instrument',
    })
  }
  const price = request.type === 'limit' && request.limitPrice ? request.limitPrice : last.close
  const [limits, costs, state, candles] = await Promise.all([getRiskLimits(), getCostModel(), portfolioState(account.id), loadCandles(request.instrumentId, { limit: 20 })])
  const turnover = avgTurnover(candles, Math.min(20, candles.length))
  const riskCheck = checkOrderRisk({
    side: request.side,
    instrumentId: request.instrumentId,
    sector: instrument.sector,
    quantity: request.quantity,
    lotSize: instrument.lotSize,
    price,
    stopLoss,
    avgTurnover: turnover,
    portfolio: state,
    limits,
    costs,
  })
  riskCheck.violations.push(...hypothesisViolations)
  riskCheck.ok = riskCheck.violations.length === 0
  const suggestedQuantity = stopLoss !== null
    ? suggestQuantity({
        equity: state.equity,
        entry: price,
        stopLoss,
        lotSize: instrument.lotSize,
        avgTurnover: turnover,
        limits,
      })
    : null
  return {
    account,
    riskCheck,
    price,
    lastClose: last.close,
    lastCloseAt: last.ts,
    stopLoss,
    suggestedQuantity,
    estimatedCommission: riskCheck.notional * costs.commissionPct / 100,
  }
}

/** Risk preview for the ticket form; nothing is stored. */
export async function previewOrder(request: Omit<OrderRequest, 'idempotencyKey'>) {
  const { account: _account, ...rest } = await assessOrder(request)
  return rest
}

/** Step 1: create a ticket with a server-side risk check. Nothing executes here. */
export async function createOrder(request: OrderRequest) {
  const [duplicate] = await db.select().from(schema.orders).where(eq(schema.orders.idempotencyKey, request.idempotencyKey))
  if (duplicate) {
    return duplicate
  }
  const { account, riskCheck, estimatedCommission } = await assessOrder(request)
  const [order] = await db.insert(schema.orders).values({
    accountId: account.id,
    hypothesisId: request.hypothesisId ?? null,
    instrumentId: request.instrumentId,
    side: request.side,
    type: request.type,
    quantity: request.quantity,
    limitPrice: request.type === 'limit' ? request.limitPrice! : null,
    status: riskCheck.ok ? 'pending_confirmation' : 'rejected',
    idempotencyKey: request.idempotencyKey,
    riskCheck,
    estimatedCommission,
    rejectReason: riskCheck.ok ? null : riskCheck.violations.join('; '),
    closedAt: riskCheck.ok ? null : new Date(),
  }).onConflictDoNothing().returning()
  return order ?? (await db.select().from(schema.orders).where(eq(schema.orders.idempotencyKey, request.idempotencyKey)))[0]!
}

/** Step 2: explicit human confirmation. Risk is re-validated against the current portfolio. */
export async function confirmOrder(orderId: string) {
  const order = await lockedTransition(orderId, 'pending_confirmation', async (o) => {
    const instrument = await getInstrument(o.instrumentId)
    const [limits, costs, state, last, candles] = await Promise.all([getRiskLimits(), getCostModel(), portfolioState(o.accountId), lastClose(o.instrumentId), loadCandles(o.instrumentId, { limit: 20 })])
    const hypothesis = await orderHypothesis(o)
    const riskCheck = checkOrderRisk({
      side: o.side as 'buy' | 'sell',
      instrumentId: o.instrumentId,
      sector: instrument.sector,
      quantity: o.quantity,
      lotSize: instrument.lotSize,
      price: o.limitPrice ?? last?.close ?? 0,
      stopLoss: hypothesis.stopLoss,
      avgTurnover: avgTurnover(candles, Math.min(20, candles.length)),
      portfolio: state,
      limits,
      costs,
    })
    riskCheck.violations.push(...hypothesis.violations)
    riskCheck.ok = riskCheck.violations.length === 0
    if (process.env.DEBUG_FIX && !riskCheck.ok) {
      console.info('[FIX:order-confirmation] Rejected stale ticket', {
        orderId,
        violations: riskCheck.violations,
      })
    }
    return riskCheck.ok
      ? {
          status: 'working',
          confirmedAt: new Date(),
          riskCheck,
        }
      : {
          status: 'rejected',
          riskCheck,
          rejectReason: `Повторная проверка риска: ${riskCheck.violations.join('; ')}`,
          closedAt: new Date(),
        }
  })
  if (order.status === 'working') {
    await tryFill(order.id)
  }
  return (await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)))[0]!
}

/** Shared by ticket creation, confirmation and execution; a saved ticket is not lasting approval. */
async function orderHypothesis(request: {
  hypothesisId?: string | null
  instrumentId: string
  side: string
}, reader: TradingReader = db, at = new Date()) {
  const violations: string[] = []
  if (!request.hypothesisId) {
    return {
      stopLoss: null,
      violations: request.side === 'buy' ? ['Покупка требует гипотезы long, поддержанной критиком и одобренной пользователем'] : violations,
    }
  }
  const [h] = await reader.select().from(schema.hypotheses).where(eq(schema.hypotheses.id, request.hypothesisId))
  if (!h || h.instrumentId !== request.instrumentId) {
    return {
      stopLoss: null,
      violations: ['Гипотеза не соответствует инструменту'],
    }
  }
  if (request.side === 'buy') {
    if (h.status !== 'user_approved' || h.direction !== 'long') {
      violations.push('Покупка требует одобренной пользователем long-гипотезы')
    }
    if (h.criticVerdict !== 'supported' || !h.validation.ok) {
      violations.push('Покупка требует поддерживающего вердикта критика и успешной валидации')
    }
    const [instrument] = await reader.select().from(schema.instruments).where(eq(schema.instruments.id, request.instrumentId))
    if (h.semanticVersion === 'legacy') {
      violations.push('Legacy-гипотеза не даёт нового разрешения на покупку: требуется новый анализ')
    }
    let expired = true
    try {
      expired = at.getTime() >= addTradingDays(h.evidenceTimestamp, h.entryScenario.validDays, {
        provider: instrument?.provider === 'mock' ? 'mock' : 'finam',
        asOf: h.evidenceTimestamp,
      }).getTime() + 86_400_000
    } catch {
      violations.push('data_quality_blocked: окно входа не подтверждено календарём')
    }
    if (expired) {
      violations.push(`Окно входа гипотезы (${h.entryScenario.validDays} торг. дн.) истекло — нужен новый анализ`)
    }
  }
  return {
    stopLoss: h.exitScenario.stopLoss,
    violations,
  }
}

export async function cancelOrder(orderId: string) {
  return lockedTransition(orderId, ['pending_confirmation', 'working'], async () => ({
    status: 'cancelled',
    closedAt: new Date(),
  }))
}

async function lockedTransition(orderId: string, from: string | string[], next: (order: typeof schema.orders.$inferSelect) => Promise<Partial<typeof schema.orders.$inferInsert>>) {
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(schema.orders).where(eq(schema.orders.id, orderId)).for('update')
    if (!order) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Order not found',
      })
    }
    const allowed = Array.isArray(from) ? from : [from]
    if (!allowed.includes(order.status)) {
      throw createError({
        statusCode: 409,
        statusMessage: `Order is ${order.status}`,
      })
    }
    const [updated] = await tx.update(schema.orders).set(await next(order)).where(eq(schema.orders.id, orderId)).returning()
    return updated!
  })
}

/**
 * Simulated execution on daily bars strictly after confirmation: market at the next
 * available open plus costs, limit only when a later bar trades through its price.
 */
async function tryFill(orderId: string) {
  const [costs, limits] = await Promise.all([getCostModel(), getRiskLimits()])
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(schema.orders).where(eq(schema.orders.id, orderId)).for('update')
    if (!order || order.status !== 'working') {
      return false
    }
    const sign = order.side === 'buy' ? 1 : -1
    if (!order.confirmedAt) {
      return false
    }
    const instrumentForQuality = await getInstrument(order.instrumentId)
    const rawBars = await loadCandles(order.instrumentId, {
      after: order.confirmedAt,
      to: new Date(),
    })
    const quality = inspectBarQuality(rawBars, {
      dataSource: instrumentForQuality.provider === 'mock' ? 'mock' : 'finam',
      board: instrumentForQuality.board,
      asOf: new Date(),
    })
    if (quality.status === 'data_quality_blocked' && rawBars.length) {
      await tx.update(schema.orders).set({
        status: 'rejected',
        rejectReason: `data_quality_blocked: ${quality.issues.join('; ')}`,
        closedAt: new Date(),
      }).where(eq(schema.orders.id, orderId))
      return false
    }
    const bars = quality.completedBars
    const fill = paperFill({
      side: order.side as 'buy' | 'sell',
      type: order.type as 'market' | 'limit',
      limitPrice: order.limitPrice,
      confirmedAt: order.confirmedAt,
    }, bars, costs)
    if (!fill) {
      return false
    }
    const { price, executedAt } = fill
    const notional = price * order.quantity
    const commission = notional * costs.commissionPct / 100
    const [account] = await tx.select().from(schema.accounts).where(eq(schema.accounts.id, order.accountId)).for('update')
    // Serialize all fills for this account, then read holdings on the same transaction.
    // Confirmation alone cannot reserve a position until the next daily bar arrives.
    const [state, instrument, candles, hypothesis] = await Promise.all([
      portfolioState(order.accountId, tx),
      getInstrument(order.instrumentId),
      loadCandles(order.instrumentId, { limit: 20 }),
      orderHypothesis(order, tx, executedAt),
    ])
    const riskCheck = checkOrderRisk({
      side: order.side as 'buy' | 'sell',
      instrumentId: order.instrumentId,
      sector: instrument.sector,
      quantity: order.quantity,
      lotSize: instrument.lotSize,
      price,
      stopLoss: hypothesis.stopLoss,
      avgTurnover: avgTurnover(candles, Math.min(20, candles.length)),
      portfolio: state,
      limits,
      costs,
    })
    riskCheck.violations.push(...hypothesis.violations)
    const cashAfter = account!.cash - sign * notional - commission
    if (cashAfter < 0) {
      riskCheck.violations.push('Недостаточно средств на момент исполнения')
    }
    riskCheck.ok = riskCheck.violations.length === 0
    if (!riskCheck.ok) {
      await tx.update(schema.orders).set({
        status: 'rejected',
        riskCheck,
        rejectReason: `Проверка при исполнении: ${riskCheck.violations.join('; ')}`,
        closedAt: new Date(),
      }).where(eq(schema.orders.id, orderId))
      if (process.env.DEBUG_FIX) {
        console.info('[FIX:paper-fill] Rejected stale order', {
          orderId,
          violations: riskCheck.violations,
        })
      }
      return false
    }
    await tx.insert(schema.executions).values({
      orderId,
      accountId: order.accountId,
      instrumentId: order.instrumentId,
      side: order.side,
      price,
      quantity: order.quantity,
      commission,
      executedAt,
    })
    await tx.update(schema.accounts).set({ cash: cashAfter }).where(eq(schema.accounts.id, order.accountId))
    await tx.update(schema.orders).set({
      status: 'filled',
      riskCheck,
      closedAt: new Date(),
    }).where(eq(schema.orders.id, orderId))
    if (order.hypothesisId && order.side === 'buy') {
      await tx.insert(schema.hypothesisEvents).values({
        hypothesisId: order.hypothesisId,
        type: 'paper_fill',
        actor: 'system',
        payload: {
          orderId,
          price,
          quantity: order.quantity,
        },
      })
    }
    return true
  })
}

/** Manual "process working orders" against newly synced candles. */
export async function processWorkingOrders() {
  const working = await db.select({ id: schema.orders.id }).from(schema.orders).where(eq(schema.orders.status, 'working'))
  let filled = 0
  for (const order of working) {
    if (await tryFill(order.id)) {
      filled++
    }
  }
  return {
    working: working.length,
    filled,
  }
}

export async function takeSnapshot(accountId: string) {
  const state = await portfolioState(accountId)
  const [row] = await db.insert(schema.portfolioSnapshots).values({
    accountId,
    cash: state.cash,
    equity: state.equity,
    positions: state.list.map(({ sector: _s, lotSize: _l, ...p }) => p),
  }).returning()
  return row!
}

export async function portfolioOverview() {
  const account = await paperAccount()
  const state = await portfolioState(account.id)
  const [orders, executions, snapshots] = await Promise.all([
    db.select({
      order: schema.orders,
      symbol: schema.instruments.symbol,
    }).from(schema.orders).innerJoin(schema.instruments, eq(schema.instruments.id, schema.orders.instrumentId)).where(eq(schema.orders.accountId, account.id)).orderBy(desc(schema.orders.createdAt)).limit(100),
    db.select({
      execution: schema.executions,
      symbol: schema.instruments.symbol,
    }).from(schema.executions).innerJoin(schema.instruments, eq(schema.instruments.id, schema.executions.instrumentId)).where(eq(schema.executions.accountId, account.id)).orderBy(desc(schema.executions.executedAt)).limit(100),
    db.select().from(schema.portfolioSnapshots).where(and(eq(schema.portfolioSnapshots.accountId, account.id), gt(schema.portfolioSnapshots.takenAt, new Date(Date.now() - 365 * 86_400_000)))).orderBy(asc(schema.portfolioSnapshots.takenAt)),
  ])
  const limits = await getRiskLimits()
  return {
    account: state.account,
    equity: state.equity,
    cash: state.cash,
    dayStartEquity: state.dayStartEquity,
    positions: state.list,
    orders,
    executions,
    snapshots,
    limits,
  }
}

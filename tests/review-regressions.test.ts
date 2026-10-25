import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnyPgTable } from 'drizzle-orm/pg-core'
import { DEFAULT_COSTS, DEFAULT_RISK_LIMITS } from '../server/domain/risk/limits'

import { nextStatusForDecision } from '../server/domain/hypotheses/state'
import { processWorkingOrders, confirmOrder, createOrder } from '../server/trading/paper-broker'
import { loadIssuerFacts } from '../server/services/issuer-fundamentals'
import { decideHypothesis } from '../server/services/hypotheses'
import { upsertDocument, searchMemory } from '../server/services/memory'

const store = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  locks: [] as string[],
  provider: 'mock' as 'mock' | 'finam',
  barsVerified: false,
  nextBarAt: '2026-10-21T00:00:00Z',
}))

vi.mock('drizzle-orm', async (original) => {
  const actual = await original<typeof import('drizzle-orm')>()
  const key = (column: { name: string }) => column.name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
  return {
    ...actual,
    eq: (column: { name: string }, value: unknown) => (row: Record<string, unknown>) => row[key(column)] === value,
    lt: (column: { name: string }, value: unknown) => (row: Record<string, unknown>) => Number(row[key(column)]) < Number(value),
    lte: (column: { name: string }, value: unknown) => (row: Record<string, unknown>) => Number(row[key(column)]) <= Number(value),
    gt: (column: { name: string }, value: unknown) => (row: Record<string, unknown>) => Number(row[key(column)]) > Number(value),
    inArray: (column: { name: string }, values: unknown[]) => (row: Record<string, unknown>) => values.includes(row[key(column)]),
    and: (...conditions: ((row: Record<string, unknown>) => boolean)[]) => (row: Record<string, unknown>) => conditions.every(condition => condition(row)),
    or: (...conditions: ((row: Record<string, unknown>) => boolean)[]) => (row: Record<string, unknown>) => conditions.some(condition => condition(row)),
    isNull: (column: { name: string }) => (row: Record<string, unknown>) => row[key(column)] == null,
  }
})

vi.mock('@nuxthub/db', async () => {
  const investment = await import('../server/db/schema/investment')
  const evidence = await import('../server/db/schema/evidence')
  const { getTableName } = await import('drizzle-orm')
  const key = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
  const client = {
    select(shape?: Record<string, { name?: string }>) {
      let table = ''
      let condition = (_row: Record<string, unknown>) => true
      let count = Infinity
      const query = {
        from(value: AnyPgTable) {
          table = getTableName(value)
          return query
        },
        innerJoin() {
          return query
        },
        where(value: typeof condition) {
          condition = value
          return query
        },
        orderBy() {
          return query
        },
        limit(value: number) {
          count = value
          return query
        },
        for() {
          store.locks.push(table)
          return query
        },
        then(resolve: (value: Record<string, unknown>[]) => unknown, reject: (error: unknown) => unknown) {
          try {
            const source = table === 'document_embeddings'
              ? (store.rows[table] ?? []).map(row => ({
                  ...row,
                  ...store.rows.documents?.find(doc => doc.id === row.documentId),
                }))
              : store.rows[table] ?? []
            const rows = source.filter(condition).slice(0, count)
            const result = rows.map((row) => {
              if (table === 'issuer_facts') {
                return row
              }
              if (!shape) {
                return { ...row }
              }
              return Object.fromEntries(Object.entries(shape).map(([alias, column]) => {
                if (alias === 'execution') {
                  return [alias, { ...row }]
                }
                if (alias === 'symbol') {
                  return [alias, 'TEST']
                }
                if (alias === 'sector') {
                  return [alias, 'test']
                }
                if (alias === 'lotSize') {
                  return [alias, 1]
                }
                return [alias, row[key(column.name ?? alias)]]
              }))
            })
            return Promise.resolve(result).then(resolve, reject)
          } catch (error) {
            return Promise.reject(error).then(resolve, reject)
          }
        },
      }
      return query
    },
    update(table: AnyPgTable) {
      let changes: Record<string, unknown>
      const query = {
        set(value: Record<string, unknown>) {
          changes = value
          return query
        },
        where(condition: (row: Record<string, unknown>) => boolean) {
          const rows = (store.rows[getTableName(table)] ?? []).filter(condition)
          for (const row of rows) {
            Object.assign(row, changes!)
          }
          return { returning: async () => rows }
        },
      }
      return query
    },
    insert(table: AnyPgTable) {
      let values: Record<string, unknown>
      let conflict: Record<string, unknown> | undefined
      const execute = () => {
        const name = getTableName(table)
        const rows = store.rows[name] ??= []
        const existing = name === 'documents' ? rows.find(row => row.kind === values.kind && row.refId === values.refId) : undefined
        if (existing) {
          Object.assign(existing, conflict?.set)
          return [existing]
        }
        const row = {
          id: `row-${rows.length}`,
          createdAt: new Date(),
          ...values,
        }
        rows.push(row)
        return [row]
      }
      const query = {
        values(value: Record<string, unknown>) {
          values = value
          return query
        },
        onConflictDoNothing() {
          return query
        },
        onConflictDoUpdate(value: Record<string, unknown>) {
          conflict = value
          return query
        },
        returning: async () => execute(),
        then(resolve: (value: Record<string, unknown>[]) => unknown) {
          return Promise.resolve(execute()).then(resolve)
        },
      }
      return query
    },
    async transaction<T>(fn: (tx: typeof client) => Promise<T>): Promise<T> {
      return fn(client)
    },
  }
  return {
    db: client,
    schema: {
      ...investment,
      ...evidence,
    },
  }
})

vi.mock('../server/services/market', () => ({
  loadResearchBars: async (options: { after?: Date }) => {
    const ready = store.provider === 'mock' || store.barsVerified
    const bars = options.after
      ? [{
          ts: store.nextBarAt,
          open: 100,
          high: 101,
          low: 99,
          close: 100,
          volume: 1e8,
        }].filter(b => new Date(b.ts) > options.after!)
      : Array.from({ length: 20 }, (_, i) => ({
          ts: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(),
          open: 100,
          high: 101,
          low: 99,
          close: 100,
          volume: 1e8,
        }))
    return {
      bars: ready ? bars : [],
      quality: {
        status: ready ? 'verified' : 'data_quality_blocked',
        issues: ready ? [] : ['contract_unverified'],
      },
      provenance: {
        source: store.provider,
        selection: {
          provider: store.provider,
          policyId: store.provider === 'mock' ? 'mock_daily' : 'legacy_daily',
          revisionCutoff: new Date().toISOString(),
          inputSetVersion: 'test-v1',
        },
      },
      gaps: [],
    }
  },
  getInstrument: async () => ({
    provider: store.provider,
    board: 'TQBR',
    id: 'a',
    kind: 'equity',
    sector: 'test',
    lotSize: 1,
  }),
  lastClose: async () => ({
    close: 100,
    ts: new Date('2026-10-21T00:00:00Z'),
  }),
  loadCandles: async (_id: string, options: { after?: Date } = {}) => options.after
    ? [{
        ts: '2026-10-21T00:00:00Z',
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1e8,
      }]
    : Array.from({ length: 20 }, () => ({
        ts: '2026-10-20T00:00:00Z',
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1e8,
      })),
}))
vi.mock('../server/services/settings', () => ({
  getRiskLimits: async () => DEFAULT_RISK_LIMITS,
  getCostModel: async () => DEFAULT_COSTS,
}))
vi.mock('../server/services/source-status', () => ({
  ensureSources: async () => {},
  recordSourceResult: async () => {},
}))

beforeEach(() => {
  store.rows = {}
  store.locks = []
  store.provider = 'mock'
  store.barsVerified = false
  store.nextBarAt = '2026-10-21T00:00:00Z'
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-20T12:00:00Z'))
  vi.stubGlobal('createError', (value: { statusMessage: string }) => new Error(value.statusMessage))
  vi.stubGlobal('useRuntimeConfig', () => ({ embeddingProvider: 'hash' }))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function order(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    accountId: 'account',
    instrumentId: 'a',
    side: 'sell',
    type: 'market',
    quantity: 10,
    limitPrice: null,
    hypothesisId: null,
    status: 'working',
    confirmedAt: new Date('2026-10-20T10:00:00Z'),
    ...overrides,
  }
}
function account() {
  store.rows.accounts = [{
    id: 'account',
    provider: 'paper',
    externalId: 'default',
    cash: 1_000_000,
  }]
  store.rows.executions = []
  store.rows.instruments = [{
    id: 'a',
    provider: 'mock',
    board: 'TQBR',
  }]
  store.rows.hypotheses = [{
    id: 'approved-h',
    instrumentId: 'a',
    status: 'user_approved',
    direction: 'long',
    criticVerdict: 'supported',
    validation: { ok: true },
    semanticVersion: 'decision_v2',
    evidenceTimestamp: new Date('2026-10-20'),
    entryScenario: { validDays: 3 },
    exitScenario: { stopLoss: 95 },
  }]
}

describe('review regressions', () => {
  it('cannot approve a disputed hypothesis by watching it first', () => {
    const watched = nextStatusForDecision('needs_review', 'watch')
    expect(() => nextStatusForDecision(watched, 'approve')).toThrow()
  })
  it('requires a valid critic gate even after watching; valid watched ideas remain approvable', () => {
    const gate = {
      criticVerdict: 'supported' as const,
      criticSucceeded: true,
      validationOk: true,
    }
    expect(nextStatusForDecision('watching', 'approve', gate)).toBe('user_approved')
    expect(() => nextStatusForDecision('watching', 'approve', {
      ...gate,
      validationOk: false,
    })).toThrow()
    expect(() => nextStatusForDecision('watching', 'approve', {
      ...gate,
      criticVerdict: 'disputed',
    })).toThrow()
    expect(() => nextStatusForDecision('ready_for_user', 'approve', {
      ...gate,
      criticSucceeded: false,
    })).toThrow()
  })
  it.each(['disputed', 'supported'])('checks the persisted %s verdict when approving a watched idea', async (verdict) => {
    store.rows.hypotheses = [{
      id: 'h',
      status: 'watching',
      criticVerdict: verdict,
      validation: { ok: true },
    }]
    if (verdict === 'disputed') {
      await expect(decideHypothesis('h', 'approve')).rejects.toThrow()
      expect(store.rows.hypotheses[0]!.status).toBe('watching')
    } else {
      expect((await decideHypothesis('h', 'approve')).status).toBe('user_approved')
    }
  })
  it('executes only one of two sales against the same ten shares', async () => {
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'))
    account()
    store.rows.executions = [{
      accountId: 'account',
      instrumentId: 'a',
      side: 'buy',
      quantity: 10,
      price: 90,
      executedAt: new Date('2026-10-19'),
    }]
    store.rows.orders = [order('one'), order('two')]
    expect((await processWorkingOrders()).filled).toBe(1)
    expect(store.rows.orders.map(row => row.status)).toEqual(['filled', 'rejected'])
    expect(store.rows.executions.filter(row => row.side === 'sell')).toHaveLength(1)
    expect(store.locks).toContain('accounts')
  })
  it('rechecks position limits when two purchases execute later', async () => {
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'))
    account()
    store.rows.orders = [order('one', {
      side: 'buy',
      quantity: 600,
      hypothesisId: 'approved-h',
    }), order('two', {
      side: 'buy',
      quantity: 600,
      hypothesisId: 'approved-h',
    })]
    expect((await processWorkingOrders()).filled).toBe(1)
    expect(store.rows.orders.map(row => row.status)).toEqual(['filled', 'rejected'])
  })
  it('cannot confirm a buy ticket without an approved hypothesis', async () => {
    account()
    store.rows.orders = [order('naked-buy', {
      side: 'buy',
      status: 'pending_confirmation',
      confirmedAt: null,
    })]
    const result = await confirmOrder('naked-buy')
    expect(result.status).toBe('rejected')
    expect(String(result.rejectReason)).toContain('критиком')
    expect(store.rows.executions).toHaveLength(0)
  })
  it('blocks a paper fill on an unverified Finam daily contract', async () => {
    account()
    store.provider = 'finam'
    store.rows.orders = [order('one', {
      side: 'buy',
      quantity: 10,
    })]
    expect((await processWorkingOrders()).filled).toBe(0)
    expect(store.rows.orders[0]!.status).toBe('suspended_data_quality')
    expect(store.rows.orders[0]!.closedAt).toBeNull()
    expect(String(store.rows.orders[0]!.rejectReason)).toContain('data_quality_blocked')
    expect(store.rows.executions).toHaveLength(0)
  })
  it('creates a durable suspended ticket when data is unavailable without filling or closing it', async () => {
    account()
    store.provider = 'finam'
    const ticket = await createOrder({
      instrumentId: 'a',
      side: 'buy',
      type: 'market',
      quantity: 10,
      hypothesisId: 'approved-h',
      idempotencyKey: 'new-data-blocked',
    })
    expect(ticket.status).toBe('suspended_data_quality')
    expect(ticket.closedAt).toBeNull()
    expect(ticket.riskCheck.paperData?.status).toBe('data_quality_blocked')
    expect(store.rows.executions).toHaveLength(0)
    expect((await createOrder({
      instrumentId: 'a',
      side: 'buy',
      type: 'market',
      quantity: 10,
      hypothesisId: 'approved-h',
      idempotencyKey: 'new-data-blocked',
    })).id).toBe(ticket.id)
    expect(store.rows.orders).toHaveLength(1)
  })
  it('keeps confirmation suspended while data is still unavailable without starting an execution clock', async () => {
    account()
    store.provider = 'finam'
    store.rows.orders = [order('pending-data', {
      status: 'pending_confirmation',
      confirmedAt: null,
      side: 'buy',
      hypothesisId: 'approved-h',
    })]
    const result = await confirmOrder('pending-data')
    expect(result.status).toBe('suspended_data_quality')
    expect(result.confirmedAt).toBeNull()
    expect(result.closedAt).toBeNull()
    expect(store.rows.executions).toHaveLength(0)
  })
  it('requires manual reconfirmation after data recovery and never fills an old bar', async () => {
    account()
    store.provider = 'finam'
    store.rows.orders = [order('suspended', {
      side: 'buy',
      quantity: 10,
      hypothesisId: 'approved-h',
    })]
    await processWorkingOrders()
    expect(store.rows.orders[0]!.status).toBe('suspended_data_quality')
    store.barsVerified = true
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'))
    await processWorkingOrders()
    expect(store.rows.executions).toHaveLength(0)
    expect(store.rows.orders[0]!.status).toBe('suspended_data_quality')
    const restored = await confirmOrder('suspended')
    expect(restored.status).toBe('working')
    expect(restored.confirmedAt).toEqual(new Date())
    expect(store.rows.executions).toHaveLength(0)
    await confirmOrder('suspended')
    expect(store.rows.orders[0]!.confirmedAt).toEqual(new Date())
    store.nextBarAt = '2026-10-23T00:00:00Z'
    vi.setSystemTime(new Date('2026-10-24T12:00:00Z'))
    expect((await processWorkingOrders()).filled).toBe(1)
    expect((await processWorkingOrders()).filled).toBe(0)
    expect(store.rows.executions).toHaveLength(1)
  })
  it('rechecks the critic when a suspended ticket is manually restored', async () => {
    account()
    store.rows.orders = [order('suspended', {
      status: 'suspended_data_quality',
      side: 'buy',
      hypothesisId: 'approved-h',
    })]
    store.rows.hypotheses[0]!.criticVerdict = 'disputed'
    expect((await confirmOrder('suspended')).status).toBe('rejected')
    expect(store.rows.executions).toHaveLength(0)
  })
  it.each(['expired', 'closed', 'disputed', 'mismatched'])('rejects confirmation of a %s hypothesis', async (reason) => {
    account()
    store.rows.hypotheses = [{
      id: 'h',
      instrumentId: reason === 'mismatched' ? 'other' : 'a',
      status: reason === 'closed' ? 'closed' : 'user_approved',
      direction: 'long',
      criticVerdict: reason === 'disputed' ? 'disputed' : 'supported',
      validation: { ok: true },
      evidenceTimestamp: new Date(reason === 'expired' ? '2026-10-01' : '2026-10-20'),
      entryScenario: { validDays: 1 },
      exitScenario: { stopLoss: 95 },
    }]
    store.rows.orders = [order('one', {
      hypothesisId: 'h',
      side: 'buy',
      status: 'pending_confirmation',
      confirmedAt: null,
    })]
    const result = await confirmOrder('one')
    expect(result.status).toBe('rejected')
    expect(store.rows.executions).toHaveLength(0)
  })
  it('makes generated retrospective text available only when actually written', async () => {
    const doc = {
      kind: 'retrospective' as const,
      refId: 'retro:h',
      instrumentId: null,
      title: 'Review',
      content: 'Today text',
      availableAt: new Date('2025-01-01'),
    }
    await upsertDocument(doc)
    expect(store.rows.documents[0]!.availableAt).toEqual(new Date())
    vi.setSystemTime(new Date('2026-10-25T12:00:00Z'))
    await upsertDocument({
      ...doc,
      content: 'Revised today',
    })
    expect(store.rows.documents[0]!.availableAt).toEqual(new Date())
  })
  it('excludes legacy backdated documents and new text revisions from past retrieval', async () => {
    store.rows.documents = [{
      id: 'd',
      kind: 'retrospective',
      refId: 'retro:h',
      availableAt: new Date('2025-01-01'),
      createdAt: new Date('2026-10-20'),
    }]
    store.rows.document_embeddings = [{ documentId: 'd' }]
    expect(await searchMemory('query', { before: new Date('2026-07-01') })).toHaveLength(0)
    expect(await searchMemory('query', { before: new Date('2026-10-21') })).toHaveLength(1)
    vi.setSystemTime(new Date('2026-10-25'))
    await upsertDocument({
      kind: 'retrospective',
      refId: 'retro:h',
      instrumentId: null,
      title: 'Revised',
      content: 'Today',
      availableAt: new Date('2025-01-01'),
    })
    expect(await searchMemory('query', { before: new Date('2026-10-24') })).toHaveLength(0)
  })
  it('preserves independent documents while removing superseded facts of the same document', async () => {
    const fact = {
      instrumentId: 'a',
      issuerId: 'issuer',
      reportingStandard: 'IFRS',
      consolidated: true,
      documentPeriodStart: '2025-01-01',
      documentPeriodEnd: '2025-12-31',
      periodStart: '2025-01-01',
      periodEnd: '2025-12-31',
      basis: 'reported',
      unit: 'млн RUB',
      publishedAt: null,
      availableAt: new Date('2026-01-01'),
    }
    store.rows.issuer_facts = [
      {
        ...fact,
        id: 'appendix',
        documentId: 'appendix',
        sourceUrl: 'https://issuer.example/appendix.pdf',
        metricKey: 'debt',
        value: '30',
      },
      {
        ...fact,
        id: 'new-profit',
        documentId: 'revised',
        sourceUrl: 'https://issuer.example/report.pdf',
        metricKey: 'net_profit',
        value: '20',
      },
      {
        ...fact,
        id: 'old-profit',
        documentId: 'original',
        sourceUrl: 'https://issuer.example/report.pdf',
        metricKey: 'net_profit',
        value: '10',
      },
      {
        ...fact,
        id: 'removed-revenue',
        documentId: 'original',
        sourceUrl: 'https://issuer.example/report.pdf',
        metricKey: 'revenue',
        value: '100',
      },
    ]
    const rows = await loadIssuerFacts('a', new Date())
    expect(rows.map(row => row.id)).toEqual(['appendix', 'new-profit'])
  })
})

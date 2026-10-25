import type { EvidenceCoverage } from '../../shared/types/evidence'
import { db, schema } from '@nuxthub/db'
import { and, asc, desc, eq, inArray, gt, sql, type SQL } from 'drizzle-orm'
import type { HypothesisStatus, StrategyId } from '../../shared/types/investment'
import { nextStatusForDecision, type DecisionAction } from '../domain/hypotheses/state'

export interface HypothesisFilter {
  status?: HypothesisStatus[]
  strategy?: StrategyId
  instrumentId?: string
  limit?: number
}

export async function listHypotheses(filter: HypothesisFilter = {}) {
  const conditions: SQL[] = []
  if (filter.status?.length) {
    conditions.push(inArray(schema.hypotheses.status, filter.status))
  }
  if (filter.strategy) {
    conditions.push(eq(schema.hypotheses.strategyId, filter.strategy))
  }
  if (filter.instrumentId) {
    conditions.push(eq(schema.hypotheses.instrumentId, filter.instrumentId))
  }
  return db.select({
    id: schema.hypotheses.id,
    runId: schema.hypotheses.runId,
    status: schema.hypotheses.status,
    semanticVersion: schema.hypotheses.semanticVersion,
    recommendation: schema.hypotheses.recommendation,
    decisionThesis: schema.hypotheses.decisionThesis,
    decisionConfidence: schema.hypotheses.decisionConfidence,
    verdictTarget: schema.hypotheses.verdictTarget,
    direction: schema.hypotheses.direction,
    strategyId: schema.hypotheses.strategyId,
    thesis: schema.hypotheses.thesis,
    confidence: schema.hypotheses.confidence,
    criticVerdict: schema.hypotheses.criticVerdict,
    horizonDays: schema.hypotheses.horizonDays,
    entry: schema.hypotheses.entryScenario,
    exit: schema.hypotheses.exitScenario,
    validationOk: sql<boolean>`(${schema.hypotheses.validation}->>'ok')::boolean`,
    evidenceTimestamp: schema.hypotheses.evidenceTimestamp,
    checkAt: schema.hypotheses.checkAt,
    createdAt: schema.hypotheses.createdAt,
    symbol: schema.instruments.symbol,
    name: schema.instruments.name,
    instrumentId: schema.instruments.id,
  }).from(schema.hypotheses)
    .innerJoin(schema.instruments, eq(schema.instruments.id, schema.hypotheses.instrumentId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.hypotheses.createdAt))
    .limit(filter.limit ?? 200)
}

export async function getHypothesis(id: string) {
  const [row] = await db.select().from(schema.hypotheses).where(eq(schema.hypotheses.id, id))
  if (!row) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Hypothesis not found',
    })
  }
  const [instrument] = await db.select().from(schema.instruments).where(eq(schema.instruments.id, row.instrumentId))
  const [version] = await db.select().from(schema.strategyVersions).where(eq(schema.strategyVersions.id, row.strategyVersionId))
  const [reviews, events, evaluations, snapshot, orders] = await Promise.all([
    db.select().from(schema.hypothesisReviews).where(eq(schema.hypothesisReviews.hypothesisId, id)).orderBy(desc(schema.hypothesisReviews.createdAt)),
    db.select().from(schema.hypothesisEvents).where(eq(schema.hypothesisEvents.hypothesisId, id)).orderBy(asc(schema.hypothesisEvents.createdAt)),
    db.select().from(schema.hypothesisEvaluations).where(eq(schema.hypothesisEvaluations.hypothesisId, id)),
    row.snapshotId
      ? db.select({
          id: schema.sourceSnapshots.id,
          sha256: schema.sourceSnapshots.sha256,
          asOf: schema.sourceSnapshots.asOf,
          capturedAt: schema.sourceSnapshots.capturedAt,
          evidenceCoverage: sql<EvidenceCoverage | null>`${schema.sourceSnapshots.payload}->'evidenceCoverage'`,
        }).from(schema.sourceSnapshots).where(eq(schema.sourceSnapshots.id, row.snapshotId))
      : Promise.resolve([]),
    db.select().from(schema.orders).where(eq(schema.orders.hypothesisId, id)).orderBy(desc(schema.orders.createdAt)),
  ])
  const [storedSnapshot] = row.snapshotId ? await db.select({ payload: schema.sourceSnapshots.payload }).from(schema.sourceSnapshots).where(eq(schema.sourceSnapshots.id, row.snapshotId)) : []
  const payload = storedSnapshot?.payload as import('../ai/contracts').EvidencePacket | undefined
  const laterSources = await db.select({ sourceId: schema.sourceFetches.sourceId }).from(schema.sourceFetches).where(gt(schema.sourceFetches.completedAt, row.evidenceTimestamp)).limit(1000)
  const sourceHealth = payload?.sourceHealth ?? []
  const audit = {
    calendarVersion: payload?.calendarVersion ?? 'legacy_unknown',
    normalizationVersion: payload?.normalizationVersion ?? 'legacy_unknown',
    dataQuality: payload?.dataQuality ?? null,
    marketProvider: instrument?.provider ?? 'unknown',
    pinnedStrategy: payload?.pinnedStrategy ?? null,
    trackRecordAuditId: payload?.trackRecord.audit?.id ?? null,
    sourceAvailability: {
      available: [...new Set(row.sources.map(source => source.sourceId ?? source.kind))],
      observedLater: [...new Set(laterSources.map(source => source.sourceId))].filter(key => !sourceHealth.some(source => source.sourceId === key && source.status === 'ok')),
      unavailable: sourceHealth.filter(source => source.status !== 'ok' && !laterSources.some(later => later.sourceId === source.sourceId)).map(source => source.sourceId),
    },
  }
  return {
    ...row,
    audit,
    instrument: instrument!,
    strategyVersion: version
      ? {
          id: version.id,
          version: version.version,
          status: version.status,
        }
      : null,
    reviews: reviews.map(({ raw: _raw, ...r }) => r),
    events,
    evaluation: evaluations[0] ?? null,
    snapshot: snapshot[0] ?? null,
    orders,
  }
}

export async function getSnapshotPayload(hypothesisId: string) {
  const [row] = await db.select({ snapshotId: schema.hypotheses.snapshotId }).from(schema.hypotheses).where(eq(schema.hypotheses.id, hypothesisId))
  if (!row?.snapshotId) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Snapshot not found',
    })
  }
  const [snapshot] = await db.select().from(schema.sourceSnapshots).where(eq(schema.sourceSnapshots.id, row.snapshotId))
  return snapshot!
}

/** A decision on the hypothesis never places an order. */
export async function decideHypothesis(id: string, action: DecisionAction, comment?: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(schema.hypotheses).where(eq(schema.hypotheses.id, id)).for('update')
    if (!row) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Hypothesis not found',
      })
    }
    let next: HypothesisStatus
    try {
      next = nextStatusForDecision(row.status as HypothesisStatus, action, {
        criticVerdict: row.criticVerdict as 'supported' | 'disputed' | 'insufficient_evidence' | null,
        criticSucceeded: row.criticVerdict !== null,
        validationOk: row.validation.ok,
      })
    } catch (error) {
      if (process.env.DEBUG_FIX) {
        console.info('[FIX:critic-gate] Decision rejected', {
          id,
          action,
          status: row.status,
        })
      }
      throw createError({
        statusCode: 409,
        statusMessage: (error as Error).message,
      })
    }
    const [updated] = await tx.update(schema.hypotheses).set({
      status: next,
      userComment: comment ?? row.userComment,
      decidedAt: action === 'defer' ? row.decidedAt : new Date(),
      updatedAt: new Date(),
    }).where(eq(schema.hypotheses.id, id)).returning()
    await tx.insert(schema.hypothesisEvents).values({
      hypothesisId: id,
      type: `user_${action}`,
      fromStatus: row.status,
      toStatus: next,
      actor: 'user',
      comment: comment ?? null,
    })
    return updated!
  })
}

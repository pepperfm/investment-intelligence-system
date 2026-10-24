import { db, schema } from '@nuxthub/db'
import { and, desc, eq } from 'drizzle-orm'
import { STRATEGY_IDS, type StrategyId, type StrategyRules } from '../../shared/types/investment'
import { DEFAULT_RULES, STRATEGY_INFO } from '../domain/strategies/rules'

export async function ensureStrategies() {
  for (const id of STRATEGY_IDS) {
    await db.insert(schema.strategies).values({
      id,
      ...STRATEGY_INFO[id],
    }).onConflictDoNothing()
    const [existing] = await db.select({ id: schema.strategyVersions.id }).from(schema.strategyVersions).where(eq(schema.strategyVersions.strategyId, id)).limit(1)
    if (!existing) {
      await db.insert(schema.strategyVersions).values({
        strategyId: id,
        version: 1,
        rules: DEFAULT_RULES[id],
        status: 'active',
        notes: 'Исходная версия правил',
        activatedAt: new Date(),
      })
    }
  }
}

export async function activeVersion(strategyId: StrategyId) {
  const [row] = await db.select().from(schema.strategyVersions).where(and(eq(schema.strategyVersions.strategyId, strategyId), eq(schema.strategyVersions.status, 'active'))).limit(1)
  if (!row) {
    throw new Error(`No active version for ${strategyId}`)
  }
  return row
}

export async function listStrategies() {
  const strategies = await db.select().from(schema.strategies)
  const versions = await db.select().from(schema.strategyVersions).orderBy(desc(schema.strategyVersions.version))
  return strategies.map(s => ({
    ...s,
    versions: versions.filter(v => v.strategyId === s.id),
  }))
}

export async function proposeVersion(strategyId: StrategyId, rules: StrategyRules, notes: string, proposedBy: 'user' | 'outcome_reviewer') {
  const [last] = await db.select({ version: schema.strategyVersions.version }).from(schema.strategyVersions).where(eq(schema.strategyVersions.strategyId, strategyId)).orderBy(desc(schema.strategyVersions.version)).limit(1)
  const [row] = await db.insert(schema.strategyVersions).values({
    strategyId,
    version: (last?.version ?? 0) + 1,
    rules,
    status: 'proposed',
    notes,
    proposedBy,
  }).returning()
  return row!
}

/** Activation never rewrites past hypotheses: they keep their strategy_version_id. */
export async function activateVersion(versionId: string) {
  return db.transaction(async (tx) => {
    const [version] = await tx.select().from(schema.strategyVersions).where(eq(schema.strategyVersions.id, versionId))
    if (!version) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Version not found',
      })
    }
    if (version.status !== 'proposed' && version.status !== 'retired') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Only proposed or retired versions can be activated',
      })
    }
    await tx.update(schema.strategyVersions).set({ status: 'retired' }).where(and(eq(schema.strategyVersions.strategyId, version.strategyId), eq(schema.strategyVersions.status, 'active')))
    const [updated] = await tx.update(schema.strategyVersions).set({
      status: 'active',
      activatedAt: new Date(),
    }).where(eq(schema.strategyVersions.id, versionId)).returning()
    return updated!
  })
}

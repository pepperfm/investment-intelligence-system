import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import type { CostModel, RiskLimits } from '../../shared/types/investment'
import { DEFAULT_COSTS, DEFAULT_RISK_LIMITS } from '../domain/risk/limits'

async function read<T extends object>(key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, key))
  return {
    ...fallback,
    ...(row?.value as Partial<T> | undefined),
  }
}

async function write(key: string, value: unknown) {
  await db.insert(schema.settings).values({
    key,
    value,
  }).onConflictDoUpdate({
    target: schema.settings.key,
    set: {
      value,
      updatedAt: new Date(),
    },
  })
}

export function getRiskLimits() {
  return read<RiskLimits>('risk_limits', DEFAULT_RISK_LIMITS)
}

export function getCostModel() {
  return read<CostModel>('cost_model', DEFAULT_COSTS)
}

export async function saveRiskLimits(value: Omit<RiskLimits, 'allowLeverage'>) {
  await write('risk_limits', {
    ...value,
    allowLeverage: false,
  })
}

export async function saveCostModel(value: CostModel) {
  await write('cost_model', value)
}

export type AiProfile = 'primary' | 'llmost'

export async function getAiProfile(): Promise<AiProfile> {
  const value = await read<{ profile: AiProfile }>('ai_profile', { profile: 'primary' })
  return value.profile === 'llmost' ? 'llmost' : 'primary'
}

export async function saveAiProfile(profile: AiProfile) {
  await write('ai_profile', { profile })
}

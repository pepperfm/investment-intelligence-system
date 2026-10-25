import { randomUUID } from 'node:crypto'
import { db, schema } from '@nuxthub/db'
import { and, eq, lt } from 'drizzle-orm'

export async function withSourceLease<T>(key: string, operation: () => Promise<T>) {
  const token = randomUUID()
  const [lease] = await db.insert(schema.evidenceSyncLocks).values({
    key,
    token,
    expiresAt: new Date(Date.now() + 15 * 60_000),
  }).onConflictDoUpdate({
    target: schema.evidenceSyncLocks.key,
    set: {
      token,
      expiresAt: new Date(Date.now() + 15 * 60_000),
    },
    setWhere: lt(schema.evidenceSyncLocks.expiresAt, new Date()),
  }).returning()
  if (!lease) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Source synchronization already running',
    })
  }
  try {
    return await operation()
  } finally {
    await db.delete(schema.evidenceSyncLocks).where(and(eq(schema.evidenceSyncLocks.key, key), eq(schema.evidenceSyncLocks.token, token)))
  }
}

import { db, schema } from '@nuxthub/db'
import { and, eq } from 'drizzle-orm'
import { getSnapshotPayload } from '../../../services/hypotheses'
import type { EvidencePacket } from '../../../ai/contracts'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const snapshot = await getSnapshotPayload(uuidParam(event))
  const packet = snapshot.payload as EvidencePacket
  const id = packet.trackRecord?.audit?.id
  if (!id) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Legacy: журнал бэктеста не сохранялся',
    })
  }
  const [audit] = await db.select().from(schema.sourceSnapshots).where(and(eq(schema.sourceSnapshots.id, id), eq(schema.sourceSnapshots.runId, snapshot.runId), eq(schema.sourceSnapshots.kind, 'track_record_audit')))
  if (!audit) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Журнал бэктеста не найден',
    })
  }
  return audit
})

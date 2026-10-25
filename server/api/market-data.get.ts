import { db, schema } from '@nuxthub/db'
import { desc } from 'drizzle-orm'
import { researchBarSelection } from '../services/market'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const audits = await db.select().from(schema.barQualityAudits).orderBy(desc(schema.barQualityAudits.observedAt)).limit(100)
  const seen = new Set<string>()
  return {
    configured: researchBarSelection(),
    series: audits.filter((a) => {
      if (seen.has(a.instrumentId)) {
        return false
      }
      seen.add(a.instrumentId)
      return true
    }).map(a => ({
      id: a.id,
      instrumentId: a.instrumentId,
      source: a.source,
      board: a.board,
      market: a.market,
      policyId: a.policyId,
      policyVersion: a.policyVersion,
      sourceRevision: a.sourceRevision,
      from: a.fromDate,
      to: a.toDate,
      observedAt: a.observedAt,
      counts: Object.fromEntries(['research_usable_with_limits', 'pending_confirmation', 'quarantined'].map(status => [status, a.payload.assessments.filter(x => x.status === status).length])),
      quarantine: a.payload.assessments.filter(x => x.status === 'quarantined').map(x => ({
        date: x.date,
        issues: x.issues,
      })),
      limits: a.payload.issues,
    })),
  }
})

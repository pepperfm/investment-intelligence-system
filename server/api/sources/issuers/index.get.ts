import { VERIFIED_REPORTS } from '../../../adapters/evidence/issuer/verified-documents'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  return VERIFIED_REPORTS.map(report => ({
    id: report.id,
    title: report.title,
    isin: report.isin,
    sourceUrl: report.sourceUrl,
    publishedAt: report.publishedAt,
    discoveryUrl: report.discoveryUrl,
  }))
})

import { contentHash, EvidenceHttpClient } from '../adapters/evidence/http'
import { withSourceLease } from './source-lock'
import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { VerifiedDocumentsProvider, VERIFIED_REPORTS, extractCbrIncomeHtml } from '../adapters/evidence/issuer/verified-documents'
import { importVerifiedIssuerDocument } from './issuer-fundamentals'
import { manualDocumentInput } from '../../shared/schemas/evidence'
import { ensureSources, recordSourceResult } from './source-status'

/** Explicit per-document command, using the fixed audited catalog; never startup/background work. */
export function syncPrimaryDocuments() {
  return withSourceLease('primary-documents', importCatalog)
}

async function importCatalog() {
  await ensureSources()
  const provider = new VerifiedDocumentsProvider()
  const results: {
    id: string
    status: string
    documentId?: string
    error?: string
  }[] = []
  for (const report of VERIFIED_REPORTS) {
    const [instrument] = await db.select().from(schema.instruments).where(eq(schema.instruments.isin, report.isin))
    if (!instrument || instrument.provider === 'mock') {
      results.push({
        id: report.id,
        status: 'not_covered',
        error: 'Verified real instrument ISIN is absent',
      })
      continue
    }
    const requestedAt = new Date()
    let bytes: Uint8Array | undefined
    let errorCode: string | null = null
    try {
      bytes = await provider.fetchDocument(report.id)
      const document = await provider.extractFacts(report.id, bytes, instrument.id, useRuntimeConfig().pdfTextBin)
      const stored = await importVerifiedIssuerDocument(document)
      results.push({
        id: report.id,
        status: stored.duplicate ? 'unchanged' : 'ok',
        documentId: stored.id,
      })
    } catch (error) {
      errorCode = 'primary_import_failed'
      console.error(`[primary-documents] ${report.id}: ${error instanceof Error ? error.message : 'failed'}`)
      results.push({
        id: report.id,
        status: 'unavailable',
        error: error instanceof Error ? error.message : 'Extraction failed',
      })
    } finally {
      await db.insert(schema.sourceFetches).values({
        sourceId: 'issuer_disclosure',
        sourceUrl: report.sourceUrl,
        requestedAt,
        completedAt: new Date(),
        httpStatus: bytes ? 200 : null,
        errorCode,
        durationMs: Date.now() - requestedAt.getTime(),
        contentHash: bytes ? contentHash(bytes) : null,
      })
    }
  }
  const [sber] = await db.select().from(schema.instruments).where(eq(schema.instruments.isin, 'RU0009029540'))
  if (sber && sber.provider !== 'mock') {
    const http = new EvidenceHttpClient()
    for (const reportDate of ['2026-09-01', '2025-09-01']) {
      const id = `sber-cbr-102-${reportDate}`
      const url = `https://www.cbr.ru/banking_sector/credit/coinfo/f102?regnum=1481&dt=${reportDate.replaceAll('-', '')}`
      try {
        const response = await http.request(url)
        const totals = extractCbrIncomeHtml(response.body)
        const periodEnd = new Date(`${reportDate}T00:00:00Z`)
        periodEnd.setUTCDate(0)
        const year = reportDate.slice(0, 4)
        const [previous] = await db.select().from(schema.issuerDocuments).where(eq(schema.issuerDocuments.sourceUrl, url)).limit(1)
        const metadata = manualDocumentInput.parse({
          instrumentId: sber.id,
          issuer: {
            name: 'ПАО Сбербанк',
            inn: '7707083893',
            ogrn: '1027700132195',
          },
          title: `Сбербанк · форма 102 на ${reportDate}`,
          sourceUrl: url,
          reportingStandard: 'BANK_REGULATORY',
          consolidated: false,
          periodStart: `${year}-01-01`,
          periodEnd: periodEnd.toISOString().slice(0, 10),
          // This is the first observed public version, not a guessed original publication date.
          publishedAt: previous?.publishedAt?.toISOString() ?? response.observedAt,
          extractedText: `CBR form 102, regnum 1481, reportDate ${reportDate}; values in тыс. RUB`,
          confirmed: true,
          facts: [
            {
              metricKey: 'bank_interest_income',
              value: totals.interestIncome,
              unit: 'тыс. RUB',
              originalUnit: 'тыс. рублей',
              locator: '0409102; раздел 1; итого; всего',
            },
            {
              metricKey: 'bank_commission_income',
              value: totals.commissionIncome,
              unit: 'тыс. RUB',
              originalUnit: 'тыс. рублей',
              locator: '0409102; раздел 2; итого; всего',
            },
          ],
        })
        const stored = await importVerifiedIssuerDocument({
          metadata,
          bytes: new TextEncoder().encode(response.body),
          publicationVerified: false,
          extractorVersion: 'cbr-f102-html-identity-units-v1',
        })
        results.push({
          id,
          status: stored.duplicate ? 'unchanged' : 'ok',
          documentId: stored.id,
        })
      } catch (error) {
        results.push({
          id,
          status: 'unavailable',
          error: error instanceof Error ? error.message : 'CBR extraction failed',
        })
      }
    }
  }
  await recordSourceResult('issuer_disclosure', results.some(result => result.status === 'unavailable') ? 'partial_primary_import' : null, results.some(result => result.status === 'ok' || result.status === 'unchanged'))
  return { results }
}

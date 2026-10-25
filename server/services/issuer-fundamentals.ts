import { db, schema } from '@nuxthub/db'
import { and, desc, eq, lte, sql, or, isNull } from 'drizzle-orm'
import type { ManualDocumentInput } from '../../shared/schemas/evidence'
import { contentHash } from '../adapters/evidence/http'
import { documentMime } from '../domain/evidence/manual-document'
import { ensureSources, recordSourceResult } from './source-status'

/** User confirms amounts/units against the original. No model extracts or guesses accounting numbers. */
export async function importIssuerDocument(input: ManualDocumentInput, bytes: Uint8Array) {
  return persistIssuerDocument(input, bytes, 'manual_verified', 'manual-confirmation-v2')
}

export async function importVerifiedIssuerDocument(document: import('../adapters/evidence/issuer/types').VerifiedIssuerDocument) {
  return persistIssuerDocument(document.metadata, document.bytes, 'machine_verified', document.extractorVersion, document.publicationVerified ?? true)
}

async function persistIssuerDocument(input: ManualDocumentInput, bytes: Uint8Array, verification: 'manual_verified' | 'machine_verified', extractorVersion: string, publicationVerified = true) {
  const mimeType = documentMime(bytes)
  const hash = contentHash(bytes)
  const { instrumentId: _instrumentId, confirmed: _confirmed, ...revision } = input
  const revisionHash = contentHash(JSON.stringify({
    ...revision,
    publishedAt: publicationVerified ? input.publishedAt : null,
    verification,
    extractorVersion,
    facts: [...input.facts].sort((a, b) => a.metricKey.localeCompare(b.metricKey)),
  }))
  await ensureSources()
  const result = await db.transaction(async (tx) => {
    const [instrument] = await tx.select().from(schema.instruments).where(eq(schema.instruments.id, input.instrumentId))
    if (!instrument || instrument.provider === 'mock') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Primary issuer documents require a real instrument, not mock data',
      })
    }
    await tx.insert(schema.issuers).values(input.issuer).onConflictDoNothing()
    const [issuer] = await tx.select().from(schema.issuers).where(eq(schema.issuers.inn, input.issuer.inn))
    if (!issuer || (input.issuer.ogrn && issuer.ogrn && input.issuer.ogrn !== issuer.ogrn)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Issuer identity conflict',
      })
    }
    await tx.insert(schema.instrumentIssuers).values({
      instrumentId: instrument.id,
      issuerId: issuer.id,
    }).onConflictDoNothing()
    const [mapping] = await tx.select().from(schema.instrumentIssuers).where(eq(schema.instrumentIssuers.instrumentId, instrument.id))
    if (mapping?.issuerId !== issuer.id) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Instrument is already linked to another issuer',
      })
    }
    const [document] = await tx.insert(schema.issuerDocuments).values({
      issuerId: issuer.id,
      sourceId: 'issuer_disclosure',
      title: input.title,
      reportingStandard: input.reportingStandard,
      consolidated: input.consolidated,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      publishedAt: publicationVerified ? new Date(input.publishedAt) : null,
      availableAt: new Date(),
      sourceUrl: input.sourceUrl,
      contentHash: hash,
      revisionHash,
      rawBase64: Buffer.from(bytes).toString('base64'),
      mimeType,
      extractedText: input.extractedText,
      extractorVersion,
      verification,
    }).onConflictDoNothing().returning({ id: schema.issuerDocuments.id })
    if (!document) {
      const [existing] = await tx.select({ id: schema.issuerDocuments.id }).from(schema.issuerDocuments).where(and(eq(schema.issuerDocuments.issuerId, issuer.id), eq(schema.issuerDocuments.contentHash, hash), eq(schema.issuerDocuments.revisionHash, revisionHash)))
      return {
        id: existing!.id,
        duplicate: true,
      }
    }
    await tx.insert(schema.issuerFacts).values(input.facts.map(fact => ({
      ...fact,
      documentId: document.id,
      periodStart: fact.periodStart ?? input.periodStart,
      periodEnd: fact.periodEnd ?? input.periodEnd,
      periodKind: fact.periodKind ?? (['cash', 'debt', 'net_debt', 'equity', 'total_assets', 'loans', 'deposits', 'capital_adequacy'].includes(fact.metricKey) ? 'instant' : 'duration'),
    })))
    return {
      id: document.id,
      duplicate: false,
    }
  })
  await recordSourceResult('issuer_disclosure', null)
  return result
}

export async function loadIssuerFacts(instrumentId: string, asOf: Date) {
  const rows = await db.select({
    id: schema.issuerFacts.id,
    documentId: schema.issuerDocuments.id,
    issuerId: schema.issuerDocuments.issuerId,
    title: schema.issuerDocuments.title,
    reportingStandard: schema.issuerDocuments.reportingStandard,
    consolidated: schema.issuerDocuments.consolidated,
    periodStart: sql<string>`coalesce(${schema.issuerFacts.periodStart}, ${schema.issuerDocuments.periodStart})`,
    periodEnd: sql<string>`coalesce(${schema.issuerFacts.periodEnd}, ${schema.issuerDocuments.periodEnd})`,
    basis: schema.issuerFacts.basis,
    periodKind: schema.issuerFacts.periodKind,
    publishedAt: schema.issuerDocuments.publishedAt,
    availableAt: schema.issuerDocuments.availableAt,
    sourceUrl: schema.issuerDocuments.sourceUrl,
    contentHash: schema.issuerDocuments.contentHash,
    verification: schema.issuerDocuments.verification,
    documentPeriodStart: schema.issuerDocuments.periodStart,
    documentPeriodEnd: schema.issuerDocuments.periodEnd,
    metricKey: schema.issuerFacts.metricKey,
    value: schema.issuerFacts.value,
    unit: schema.issuerFacts.unit,
    originalUnit: schema.issuerFacts.originalUnit,
    locator: schema.issuerFacts.locator,
  }).from(schema.issuerFacts)
    .innerJoin(schema.issuerDocuments, eq(schema.issuerDocuments.id, schema.issuerFacts.documentId))
    .innerJoin(schema.instrumentIssuers, eq(schema.instrumentIssuers.issuerId, schema.issuerDocuments.issuerId))
    .where(and(eq(schema.instrumentIssuers.instrumentId, instrumentId), lte(schema.issuerDocuments.availableAt, asOf), or(isNull(schema.issuerDocuments.publishedAt), lte(schema.issuerDocuments.publishedAt, asOf))))
    .orderBy(desc(schema.issuerDocuments.availableAt), desc(schema.issuerDocuments.periodEnd), desc(schema.issuerDocuments.id))
  const seen = new Set<string>()
  const documents = new Map<string, string>()
  const selected = rows.filter((row) => {
    // A source URL identifies a document lineage; another report for the same period is independent.
    const documentPeriod = [row.sourceUrl, row.reportingStandard, row.consolidated, row.documentPeriodStart, row.documentPeriodEnd].join(':')
    const period = [row.reportingStandard, row.consolidated, row.periodStart, row.periodEnd, row.basis].join(':')
    const document = documents.get(documentPeriod)
    if (document && document !== row.documentId) {
      return false
    }
    documents.set(documentPeriod, row.documentId)
    const key = `${period}:${row.metricKey}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  }).slice(0, 100)
  if (process.env.DEBUG_FIX) {
    console.info('[FIX:issuer-facts] Selected current document facts', {
      loaded: rows.length,
      selected: selected.length,
    })
  }
  return selected
}

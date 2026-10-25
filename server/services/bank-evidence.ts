import { db, schema } from '@nuxthub/db'
import { and, desc, eq, lte } from 'drizzle-orm'
import type { BankFormSnapshot, RegulatoryIdentitySnapshot } from '../../shared/types/evidence'

export async function saveBankForm(issuerId: string, form: BankFormSnapshot) {
  const [latest] = await db.select().from(schema.bankReports).where(and(
    eq(schema.bankReports.issuerId, issuerId), eq(schema.bankReports.form, form.form), eq(schema.bankReports.reportDate, form.reportDate),
  )).orderBy(desc(schema.bankReports.availableAt)).limit(1)
  if (latest?.contentHash === form.provenance.contentHash) {
    return
  }
  await db.insert(schema.bankReports).values({
    issuerId,
    form: form.form,
    reportDate: form.reportDate,
    unit: form.unit,
    rows: form.rows,
    availableAt: new Date(form.provenance.availableAt!),
    contentHash: form.provenance.contentHash,
    provenance: form.provenance,
  }).onConflictDoNothing()
}

export async function saveRegulatoryIdentity(issuerId: string, identity: RegulatoryIdentitySnapshot) {
  const [latest] = await db.select().from(schema.issuerRegulatorySnapshots).where(eq(schema.issuerRegulatorySnapshots.issuerId, issuerId)).orderBy(desc(schema.issuerRegulatorySnapshots.availableAt)).limit(1)
  if (latest?.contentHash === identity.provenance.contentHash) {
    return
  }
  await db.insert(schema.issuerRegulatorySnapshots).values({
    issuerId,
    payload: identity,
    contentHash: identity.provenance.contentHash,
    availableAt: new Date(identity.provenance.availableAt!),
  }).onConflictDoNothing()
}

export async function bankEvidence(instrumentId: string, asOf = new Date()) {
  const [mapping] = await db.select().from(schema.instrumentIssuers).where(eq(schema.instrumentIssuers.instrumentId, instrumentId))
  if (!mapping) {
    return {
      reports: [],
      regulatory: null,
    }
  }
  const rows = await db.select().from(schema.bankReports).where(and(
    eq(schema.bankReports.issuerId, mapping.issuerId), lte(schema.bankReports.availableAt, asOf), lte(schema.bankReports.reportDate, asOf.toISOString().slice(0, 10)),
  )).orderBy(desc(schema.bankReports.reportDate), desc(schema.bankReports.availableAt)).limit(100)
  const seen = new Set<string>()
  const reports = rows.filter((row) => {
    const key = `${row.form}:${row.reportDate}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
  const [regulatory] = await db.select().from(schema.issuerRegulatorySnapshots).where(and(
    eq(schema.issuerRegulatorySnapshots.issuerId, mapping.issuerId), lte(schema.issuerRegulatorySnapshots.availableAt, asOf),
  )).orderBy(desc(schema.issuerRegulatorySnapshots.availableAt)).limit(1)
  return {
    reports,
    regulatory: regulatory?.payload ?? null,
  }
}

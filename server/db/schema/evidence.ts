import { pgTable, text, uuid, timestamp, jsonb, integer, numeric, boolean, date, index, uniqueIndex } from 'drizzle-orm/pg-core'
import type { SourceStatus, EvidenceProvenance } from '../../../shared/types/evidence'
import { instruments } from './investment'

export const dataSources = pgTable('data_sources', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  sourceUrl: text('source_url').notNull(),
  tier: text('tier').notNull(),
  accessMode: text('access_mode').notNull().default('public'),
  accessTerms: text('access_terms').notNull(),
  coverage: jsonb('coverage').$type<string[]>().notNull(),
  status: text('status').$type<SourceStatus>().notNull().default('not_covered'),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  lastErrorCode: text('last_error_code'),
})

export const sourceFetches = pgTable('source_fetches', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: text('source_id').notNull().references(() => dataSources.id),
  sourceUrl: text('source_url').notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),
  httpStatus: integer('http_status'),
  errorCode: text('error_code'),
  durationMs: integer('duration_ms').notNull(),
  contentHash: text('content_hash'),
  etag: text('etag'),
  lastModified: text('last_modified'),
  // Bounded raw payload; pruned after 30 days, immutable facts retain hashes.
  rawBody: text('raw_body'),
}, table => [index('source_fetches_source_date_idx').on(table.sourceId, table.completedAt)])

export const evidenceSyncLocks = pgTable('evidence_sync_locks', {
  key: text('key').primaryKey(),
  token: uuid('token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const macroSeries = pgTable('macro_series', {
  id: text('id').primaryKey(),
  sourceId: text('source_id').notNull().references(() => dataSources.id),
  label: text('label').notNull(),
  unit: text('unit').notNull(),
  periodicity: text('periodicity').notNull(),
  methodology: text('methodology').notNull(),
})

export const macroObservations = pgTable('macro_observations', {
  id: uuid('id').primaryKey().defaultRandom(),
  seriesId: text('series_id').notNull().references(() => macroSeries.id),
  periodDate: date('period_date').notNull(),
  value: numeric('value').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  contentHash: text('content_hash').notNull(),
  provenance: jsonb('provenance').$type<EvidenceProvenance>().notNull(),
}, table => [
  uniqueIndex('macro_observations_version_idx').on(table.seriesId, table.periodDate, table.availableAt),
  index('macro_observations_asof_idx').on(table.seriesId, table.periodDate, table.availableAt),
])

export const regulatoryEvents = pgTable('regulatory_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: text('source_id').notNull().references(() => dataSources.id),
  externalId: text('external_id').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  category: text('category').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  contentHash: text('content_hash').notNull(),
  provenance: jsonb('provenance').$type<EvidenceProvenance>().notNull(),
}, table => [
  uniqueIndex('regulatory_events_version_idx').on(table.sourceId, table.externalId, table.availableAt),
  index('regulatory_events_asof_idx').on(table.availableAt, table.publishedAt),
])

export const issuers = pgTable('issuers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  inn: text('inn').notNull().unique(),
  ogrn: text('ogrn'),
  regNum: text('reg_num'),
  intCode: text('int_code'),
})

export const instrumentIssuers = pgTable('instrument_issuers', {
  instrumentId: uuid('instrument_id').primaryKey().references(() => instruments.id),
  issuerId: uuid('issuer_id').notNull().references(() => issuers.id),
})

export const issuerDocuments = pgTable('issuer_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  issuerId: uuid('issuer_id').notNull().references(() => issuers.id),
  sourceId: text('source_id').notNull().references(() => dataSources.id),
  title: text('title').notNull(),
  reportingStandard: text('reporting_standard').notNull(),
  consolidated: boolean('consolidated').notNull(),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  sourceUrl: text('source_url').notNull(),
  contentHash: text('content_hash').notNull(),
  revisionHash: text('revision_hash').notNull(),
  rawBase64: text('raw_base64').notNull(),
  mimeType: text('mime_type').notNull(),
  extractedText: text('extracted_text').notNull(),
  extractorVersion: text('extractor_version').notNull(),
  verification: text('verification').notNull(),
}, table => [
  uniqueIndex('issuer_documents_version_idx').on(table.issuerId, table.contentHash, table.revisionHash),
  index('issuer_documents_period_idx').on(table.issuerId, table.periodEnd, table.publishedAt),
])

export const issuerFacts = pgTable('issuer_facts', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => issuerDocuments.id),
  metricKey: text('metric_key').notNull(),
  value: numeric('value').notNull(),
  unit: text('unit').notNull(),
  originalUnit: text('original_unit').notNull(),
  locator: text('locator').notNull(),
  periodStart: date('period_start'),
  periodEnd: date('period_end'),
  basis: text('basis').notNull().default('reported'),
  periodKind: text('period_kind').notNull().default('duration'),
}, table => [uniqueIndex('issuer_facts_metric_idx').on(table.documentId, table.metricKey, table.periodStart, table.periodEnd, table.basis)])

export const bankReports = pgTable('bank_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  issuerId: uuid('issuer_id').notNull().references(() => issuers.id),
  form: integer('form').notNull(),
  reportDate: date('report_date').notNull(),
  unit: text('unit'),
  rows: jsonb('rows').$type<Record<string, string>[]>().notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  contentHash: text('content_hash').notNull(),
  provenance: jsonb('provenance').$type<EvidenceProvenance>().notNull(),
}, table => [
  uniqueIndex('bank_reports_version_idx').on(table.issuerId, table.form, table.reportDate, table.availableAt),
  index('bank_reports_asof_idx').on(table.issuerId, table.reportDate, table.availableAt),
])

export const issuerRegulatorySnapshots = pgTable('issuer_regulatory_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  issuerId: uuid('issuer_id').notNull().references(() => issuers.id),
  payload: jsonb('payload').$type<import('../../../shared/types/evidence').RegulatoryIdentitySnapshot>().notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  contentHash: text('content_hash').notNull(),
}, table => [
  uniqueIndex('issuer_regulatory_version_idx').on(table.issuerId, table.availableAt),
  index('issuer_regulatory_asof_idx').on(table.issuerId, table.availableAt),
])

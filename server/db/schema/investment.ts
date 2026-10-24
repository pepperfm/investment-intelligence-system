import { pgTable, uuid, text, timestamp, integer, doublePrecision, boolean, jsonb, index, uniqueIndex, primaryKey, vector } from 'drizzle-orm/pg-core'
import type { MetricValues, AgentFinding, EntryScenario, ExitScenario, EvidenceItem, SourceRef, StrategyRules, RiskCheckResult, EvaluationCosts, PositionSnapshot, RunLogEntry } from '../../../shared/types/investment'

export const EMBEDDING_DIMENSIONS = 256

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const instruments = pgTable('instruments', {
  id: uuid('id').primaryKey().defaultRandom(),
  symbol: text('symbol').notNull().unique(),
  ticker: text('ticker').notNull(),
  board: text('board').notNull(),
  name: text('name').notNull(),
  sector: text('sector').notNull().default('other'),
  kind: text('kind').notNull().default('equity'),
  lotSize: integer('lot_size').notNull().default(1),
  currency: text('currency').notNull().default('RUB'),
  isin: text('isin'),
  provider: text('provider').notNull(),
  active: boolean('active').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const candles = pgTable('candles', {
  instrumentId: uuid('instrument_id').notNull().references(() => instruments.id, { onDelete: 'cascade' }),
  timeframe: text('timeframe').notNull(),
  ts: timestamp('ts', { withTimezone: true }).notNull(),
  open: doublePrecision('open').notNull(),
  high: doublePrecision('high').notNull(),
  low: doublePrecision('low').notNull(),
  close: doublePrecision('close').notNull(),
  volume: doublePrecision('volume').notNull(),
}, table => [primaryKey({ columns: [table.instrumentId, table.timeframe, table.ts] })])

export const marketEvents = pgTable('market_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  externalId: text('external_id').notNull().unique(),
  instrumentId: uuid('instrument_id').references(() => instruments.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  url: text('url'),
  source: text('source').notNull(),
  sentiment: doublePrecision('sentiment'),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
  retrievedAt: timestamp('retrieved_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('market_events_instrument_idx').on(table.instrumentId, table.publishedAt)])

export const issuerReports = pgTable('issuer_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  externalId: text('external_id').notNull().unique(),
  instrumentId: uuid('instrument_id').notNull().references(() => instruments.id, { onDelete: 'cascade' }),
  period: text('period').notNull(),
  reportType: text('report_type').notNull(),
  metrics: jsonb('metrics').$type<Record<string, number>>().notNull(),
  source: text('source').notNull(),
  url: text('url'),
  documentUrl: text('document_url'),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
}, table => [index('issuer_reports_instrument_idx').on(table.instrumentId, table.publishedAt)])

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  refId: text('ref_id').notNull(),
  instrumentId: uuid('instrument_id').references(() => instruments.id, { onDelete: 'set null' }),
  strategyId: text('strategy_id'),
  title: text('title').notNull(),
  content: text('content').notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, table => [uniqueIndex('documents_ref_idx').on(table.kind, table.refId), index('documents_available_idx').on(table.availableAt)])

export const documentEmbeddings = pgTable('document_embeddings', {
  documentId: uuid('document_id').primaryKey().references(() => documents.id, { onDelete: 'cascade' }),
  model: text('model').notNull(),
  embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
  createdAt: createdAt(),
}, table => [index('document_embeddings_hnsw_idx').using('hnsw', table.embedding.op('vector_cosine_ops'))])

export const strategies = pgTable('strategies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
})

export const strategyVersions = pgTable('strategy_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  strategyId: text('strategy_id').notNull().references(() => strategies.id),
  version: integer('version').notNull(),
  rules: jsonb('rules').$type<StrategyRules>().notNull(),
  status: text('status').notNull(),
  notes: text('notes').notNull().default(''),
  proposedBy: text('proposed_by').notNull().default('system'),
  createdAt: createdAt(),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
}, table => [uniqueIndex('strategy_versions_version_idx').on(table.strategyId, table.version)])

export const analysisRuns = pgTable('analysis_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  kind: text('kind').notNull(),
  strategies: jsonb('strategies').$type<string[]>().notNull(),
  instrumentIds: jsonb('instrument_ids').$type<string[]>().notNull(),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
  status: text('status').notNull(),
  provider: text('provider').notNull(),
  criticProvider: text('critic_provider').notNull(),
  rulesVersions: jsonb('rules_versions').$type<Record<string, number>>().notNull().default({}),
  log: jsonb('log').$type<RunLogEntry[]>().notNull().default([]),
  summary: jsonb('summary').$type<Record<string, unknown>>(),
  error: text('error'),
  createdAt: createdAt(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, table => [index('analysis_runs_created_idx').on(table.createdAt)])

export const sourceSnapshots = pgTable('source_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => analysisRuns.id, { onDelete: 'cascade' }),
  instrumentId: uuid('instrument_id').references(() => instruments.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(),
  payload: jsonb('payload').$type<unknown>().notNull(),
  sha256: text('sha256').notNull(),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
  capturedAt: createdAt(),
}, table => [index('source_snapshots_run_idx').on(table.runId)])

export const hypotheses = pgTable('hypotheses', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => analysisRuns.id, { onDelete: 'cascade' }),
  instrumentId: uuid('instrument_id').notNull().references(() => instruments.id),
  strategyId: text('strategy_id').notNull().references(() => strategies.id),
  strategyVersionId: uuid('strategy_version_id').notNull().references(() => strategyVersions.id),
  snapshotId: uuid('snapshot_id').references(() => sourceSnapshots.id),
  direction: text('direction').notNull(),
  horizonDays: integer('horizon_days').notNull(),
  thesis: text('thesis').notNull(),
  supportingEvidence: jsonb('supporting_evidence').$type<EvidenceItem[]>().notNull(),
  counterEvidence: jsonb('counter_evidence').$type<EvidenceItem[]>().notNull(),
  assumptions: jsonb('assumptions').$type<string[]>().notNull(),
  invalidationConditions: jsonb('invalidation_conditions').$type<string[]>().notNull(),
  entryScenario: jsonb('entry_scenario').$type<EntryScenario>().notNull(),
  exitScenario: jsonb('exit_scenario').$type<ExitScenario>().notNull(),
  riskNotes: jsonb('risk_notes').$type<string[]>().notNull(),
  alternatives: jsonb('alternatives').$type<string[]>().notNull().default([]),
  sources: jsonb('sources').$type<SourceRef[]>().notNull(),
  metrics: jsonb('metrics').$type<MetricValues>().notNull(),
  validation: jsonb('validation').$type<{
    ok: boolean
    issues: string[]
  }>().notNull(),
  confidence: doublePrecision('confidence').notNull(),
  evidenceTimestamp: timestamp('evidence_timestamp', { withTimezone: true }).notNull(),
  checkAt: timestamp('check_at', { withTimezone: true }).notNull(),
  status: text('status').notNull(),
  criticVerdict: text('critic_verdict'),
  criticFindings: jsonb('critic_findings').$type<AgentFinding[]>().notNull().default([]),
  analystProvider: text('analyst_provider').notNull(),
  analystVersion: text('analyst_version').notNull(),
  userComment: text('user_comment'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('hypotheses_status_idx').on(table.status), index('hypotheses_instrument_idx').on(table.instrumentId), index('hypotheses_run_idx').on(table.runId)])

export const hypothesisReviews = pgTable('hypothesis_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  hypothesisId: uuid('hypothesis_id').notNull().references(() => hypotheses.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  provider: text('provider').notNull(),
  verdict: text('verdict').notNull(),
  summary: text('summary').notNull(),
  findings: jsonb('findings').$type<AgentFinding[]>().notNull(),
  missingChecks: jsonb('missing_checks').$type<string[]>().notNull(),
  raw: jsonb('raw').$type<unknown>(),
  durationMs: integer('duration_ms'),
  createdAt: createdAt(),
}, table => [index('hypothesis_reviews_hypothesis_idx').on(table.hypothesisId)])

export const hypothesisEvents = pgTable('hypothesis_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  hypothesisId: uuid('hypothesis_id').notNull().references(() => hypotheses.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  actor: text('actor').notNull(),
  comment: text('comment'),
  payload: jsonb('payload').$type<Record<string, unknown>>(),
  createdAt: createdAt(),
}, table => [index('hypothesis_events_hypothesis_idx').on(table.hypothesisId, table.createdAt)])

export const hypothesisEvaluations = pgTable('hypothesis_evaluations', {
  id: uuid('id').primaryKey().defaultRandom(),
  hypothesisId: uuid('hypothesis_id').notNull().references(() => hypotheses.id, { onDelete: 'cascade' }),
  isCounterfactual: boolean('is_counterfactual').notNull(),
  entered: boolean('entered').notNull(),
  entryAt: timestamp('entry_at', { withTimezone: true }),
  exitAt: timestamp('exit_at', { withTimezone: true }),
  entryPrice: doublePrecision('entry_price'),
  exitPrice: doublePrecision('exit_price'),
  exitReason: text('exit_reason').notNull(),
  grossReturn: doublePrecision('gross_return').notNull(),
  netReturn: doublePrecision('net_return').notNull(),
  benchmarkReturn: doublePrecision('benchmark_return').notNull(),
  excessReturn: doublePrecision('excess_return').notNull(),
  maxDrawdown: doublePrecision('max_drawdown').notNull(),
  maxFavorable: doublePrecision('max_favorable').notNull(),
  outcome: text('outcome').notNull(),
  costs: jsonb('costs').$type<EvaluationCosts>().notNull(),
  evaluatedAt: createdAt(),
}, table => [uniqueIndex('hypothesis_evaluations_hypothesis_idx').on(table.hypothesisId)])

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(),
  externalId: text('external_id').notNull(),
  name: text('name').notNull(),
  currency: text('currency').notNull().default('RUB'),
  initialCash: doublePrecision('initial_cash').notNull(),
  cash: doublePrecision('cash').notNull(),
  createdAt: createdAt(),
}, table => [uniqueIndex('accounts_external_idx').on(table.provider, table.externalId)])

export const portfolioSnapshots = pgTable('portfolio_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  takenAt: timestamp('taken_at', { withTimezone: true }).notNull().defaultNow(),
  cash: doublePrecision('cash').notNull(),
  equity: doublePrecision('equity').notNull(),
  positions: jsonb('positions').$type<PositionSnapshot[]>().notNull(),
}, table => [index('portfolio_snapshots_account_idx').on(table.accountId, table.takenAt)])

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  hypothesisId: uuid('hypothesis_id').references(() => hypotheses.id, { onDelete: 'set null' }),
  instrumentId: uuid('instrument_id').notNull().references(() => instruments.id),
  side: text('side').notNull(),
  type: text('type').notNull(),
  quantity: integer('quantity').notNull(),
  limitPrice: doublePrecision('limit_price'),
  status: text('status').notNull(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  riskCheck: jsonb('risk_check').$type<RiskCheckResult>().notNull(),
  estimatedCommission: doublePrecision('estimated_commission').notNull(),
  rejectReason: text('reject_reason'),
  createdAt: createdAt(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
}, table => [index('orders_account_idx').on(table.accountId, table.createdAt)])

export const executions = pgTable('executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  instrumentId: uuid('instrument_id').notNull().references(() => instruments.id),
  side: text('side').notNull(),
  price: doublePrecision('price').notNull(),
  quantity: integer('quantity').notNull(),
  commission: doublePrecision('commission').notNull(),
  executedAt: timestamp('executed_at', { withTimezone: true }).notNull(),
}, table => [index('executions_account_idx').on(table.accountId, table.executedAt)])

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

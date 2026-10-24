import { db, schema } from '@nuxthub/db'
import { and, cosineDistance, eq, inArray, lte, ne, sql } from 'drizzle-orm'
import { EMBEDDING_DIMENSIONS } from '../db/schema/investment'
import { HASH_EMBEDDING_MODEL, hashEmbedding } from '../domain/memory/embedding'

export interface MemoryDocument {
  kind: 'event' | 'report' | 'hypothesis' | 'review' | 'retrospective'
  refId: string
  instrumentId: string | null
  strategyId?: string | null
  title: string
  content: string
  availableAt: Date
}

async function embed(text: string): Promise<{
  model: string
  vector: number[]
}> {
  const config = useRuntimeConfig()
  if (config.embeddingProvider !== 'openai') {
    return {
      model: HASH_EMBEDDING_MODEL,
      vector: hashEmbedding(text, EMBEDDING_DIMENSIONS),
    }
  }
  if (!config.embeddingUrl || !config.embeddingModel) {
    throw new Error('NUXT_EMBEDDING_URL and NUXT_EMBEDDING_MODEL are required for the openai embedding provider')
  }
  const response = await fetch(`${config.embeddingUrl.replace(/\/$/, '')}/embeddings`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(config.embeddingKey ? { authorization: `Bearer ${config.embeddingKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.embeddingModel,
      input: text.slice(0, 8000),
      dimensions: EMBEDDING_DIMENSIONS,
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    throw new Error(`Embedding request failed: HTTP ${response.status}`)
  }
  const body = await response.json() as { data: { embedding: number[] }[] }
  const vector = body.data[0]?.embedding
  if (!vector || vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Embedding model must return ${EMBEDDING_DIMENSIONS} dimensions`)
  }
  return {
    model: config.embeddingModel,
    vector,
  }
}

export async function upsertDocument(doc: MemoryDocument) {
  const [row] = await db.insert(schema.documents).values({
    kind: doc.kind,
    refId: doc.refId,
    instrumentId: doc.instrumentId,
    strategyId: doc.strategyId ?? null,
    title: doc.title,
    content: doc.content,
    availableAt: doc.availableAt,
  }).onConflictDoUpdate({
    target: [schema.documents.kind, schema.documents.refId],
    set: {
      title: doc.title,
      content: doc.content,
      availableAt: doc.availableAt,
    },
  }).returning({ id: schema.documents.id })
  const { model, vector } = await embed(`${doc.title}\n${doc.content}`)
  await db.insert(schema.documentEmbeddings).values({
    documentId: row!.id,
    model,
    embedding: vector,
  }).onConflictDoUpdate({
    target: schema.documentEmbeddings.documentId,
    set: {
      model,
      embedding: vector,
      createdAt: new Date(),
    },
  })
  return row!.id
}

export interface SearchOptions {
  limit?: number
  /** Point-in-time cutoff: documents that became available later are invisible. */
  before?: Date
  kinds?: MemoryDocument['kind'][]
  excludeRefPrefix?: string
  excludeInstrumentId?: string
}

export async function searchMemory(query: string, options: SearchOptions = {}) {
  const { vector } = await embed(query)
  const distance = cosineDistance(schema.documentEmbeddings.embedding, vector)
  const conditions = []
  if (options.before) {
    conditions.push(lte(schema.documents.availableAt, options.before))
  }
  if (options.kinds?.length) {
    conditions.push(inArray(schema.documents.kind, options.kinds))
  }
  if (options.excludeRefPrefix) {
    conditions.push(sql`${schema.documents.refId} not like ${options.excludeRefPrefix + '%'}`)
  }
  if (options.excludeInstrumentId) {
    conditions.push(ne(schema.documents.instrumentId, options.excludeInstrumentId))
  }
  const rows = await db.select({
    id: schema.documents.id,
    kind: schema.documents.kind,
    refId: schema.documents.refId,
    instrumentId: schema.documents.instrumentId,
    strategyId: schema.documents.strategyId,
    title: schema.documents.title,
    content: schema.documents.content,
    availableAt: schema.documents.availableAt,
    distance,
  }).from(schema.documentEmbeddings)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentEmbeddings.documentId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(distance)
    .limit(options.limit ?? 10)
  return rows.map(({ distance: d, ...rest }) => ({
    ...rest,
    similarity: 1 - Number(d),
  }))
}

export async function reindexMemory() {
  const docs = await db.select().from(schema.documents)
  for (const doc of docs) {
    const { model, vector } = await embed(`${doc.title}\n${doc.content}`)
    await db.insert(schema.documentEmbeddings).values({
      documentId: doc.id,
      model,
      embedding: vector,
    }).onConflictDoUpdate({
      target: schema.documentEmbeddings.documentId,
      set: {
        model,
        embedding: vector,
        createdAt: new Date(),
      },
    })
  }
  return { reindexed: docs.length }
}

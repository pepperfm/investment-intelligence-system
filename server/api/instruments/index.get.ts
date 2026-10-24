import { db, schema } from '@nuxthub/db'
import { asc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  return db.select().from(schema.instruments).orderBy(asc(schema.instruments.kind), asc(schema.instruments.ticker))
})

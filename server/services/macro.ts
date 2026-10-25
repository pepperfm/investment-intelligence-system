import { macroChanges } from '../domain/evidence/macro-changes'
import { regulatoryLinks } from '../domain/evidence/event-links'
import { db, schema } from '@nuxthub/db'
import { and, desc, eq, isNull, lte, or } from 'drizzle-orm'
import { percentageChange } from '../domain/evidence/provenance'

export async function macroHistory(asOf = new Date()) {
  const rows = await db.select({
    id: schema.macroObservations.id,
    seriesKey: schema.macroSeries.id,
    label: schema.macroSeries.label,
    unit: schema.macroSeries.unit,
    periodicity: schema.macroSeries.periodicity,
    date: schema.macroObservations.periodDate,
    value: schema.macroObservations.value,
    provenance: schema.macroObservations.provenance,
  }).from(schema.macroObservations).innerJoin(schema.macroSeries, eq(schema.macroSeries.id, schema.macroObservations.seriesId))
    .where(and(
      lte(schema.macroObservations.availableAt, asOf),
      lte(schema.macroObservations.observedAt, asOf),
      lte(schema.macroObservations.periodDate, asOf.toISOString().slice(0, 10)),
      or(isNull(schema.macroObservations.publishedAt), lte(schema.macroObservations.publishedAt, asOf)),
    )).orderBy(desc(schema.macroObservations.periodDate), desc(schema.macroObservations.availableAt)).limit(5000)
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = `${row.seriesKey}:${row.date}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

export async function macroOverview(asOf = new Date()) {
  const history = await macroHistory(asOf)
  const keys = [...new Set(history.map(row => row.seriesKey))]
  return keys.map((key) => {
    const observations = history.filter(row => row.seriesKey === key)
    const current = observations[0]!
    const previous = observations[1] ?? null
    return {
      ...current,
      ...macroChanges(current, observations),
      previous,
      changePct: percentageChange(current.value, previous?.value ?? null),
      history: observations.slice(0, 100),
    }
  })
}

export async function regulatoryHistory(asOf = new Date(), limit = 30) {
  const rows = await db.select().from(schema.regulatoryEvents).where(and(
    lte(schema.regulatoryEvents.availableAt, asOf),
    lte(schema.regulatoryEvents.publishedAt, asOf),
  )).orderBy(desc(schema.regulatoryEvents.publishedAt), desc(schema.regulatoryEvents.availableAt)).limit(500)
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (seen.has(row.externalId)) {
      return false
    }
    seen.add(row.externalId)
    return true
  }).slice(0, limit).map(row => ({
    ...row,
    links: regulatoryLinks(row),
  }))
}

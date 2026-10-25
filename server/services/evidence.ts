import { randomUUID } from 'node:crypto'
import { db, schema } from '@nuxthub/db'
import { and, desc, eq, lt, sql } from 'drizzle-orm'
import type { MacroObservation, RegulatoryEvent } from '../../shared/types/evidence'
import { EvidenceHttpClient, SourceHttpError, type SourceResponse } from '../adapters/evidence/http'
import { fetchKeyRate, parseKeyRate, parseFx, DAILY_URL, FX_URL } from '../adapters/evidence/cbr/daily'
import { CBR_RSS_URL, parseCbrRss } from '../adapters/evidence/cbr/rss'
import { STATISTICS_URL, parseMoneySupply, VERIFIED_MONETARY_SERIES } from '../adapters/evidence/cbr/statistics'
import { parseFinOrg } from '../adapters/evidence/cbr/finorg'
import { saveBankForm, saveRegulatoryIdentity } from './bank-evidence'
import { BANKS_URL, FINORG_URL, fetchCbrSoap, parseBankIdentities, parseBankDates, parseFullBankForm } from '../adapters/evidence/cbr/banks'
import { ensureSources, recordSourceResult, listSources } from './source-status'
import { upsertDocument } from './memory'

const http = new EvidenceHttpClient()

export async function persistMacro(observations: MacroObservation[]) {
  for (const observation of observations) {
    await db.insert(schema.macroSeries).values({
      id: observation.seriesKey,
      sourceId: observation.provenance.sourceId,
      label: observation.label,
      unit: observation.unit,
      periodicity: observation.periodicity,
      methodology: 'Официальное наблюдение; исторические vintages не подтверждены. Доступно с первого получения IIS.',
    }).onConflictDoNothing()
    const [series] = await db.select().from(schema.macroSeries).where(eq(schema.macroSeries.id, observation.seriesKey))
    if (!series || series.unit !== observation.unit || series.periodicity !== observation.periodicity || series.sourceId !== observation.provenance.sourceId) {
      throw new Error('Macro unit, nominal or methodology changed; refusing incompatible history')
    }
    const [latest] = await db.select().from(schema.macroObservations).where(and(
      eq(schema.macroObservations.seriesId, observation.seriesKey),
      eq(schema.macroObservations.periodDate, observation.date),
    )).orderBy(desc(schema.macroObservations.availableAt)).limit(1)
    if (latest?.contentHash === observation.provenance.contentHash) {
      continue
    }
    await db.insert(schema.macroObservations).values({
      seriesId: observation.seriesKey,
      periodDate: observation.date,
      value: observation.value,
      publishedAt: observation.provenance.publishedAt ? new Date(observation.provenance.publishedAt) : null,
      availableAt: new Date(observation.provenance.availableAt!),
      observedAt: new Date(observation.provenance.observedAt),
      contentHash: observation.provenance.contentHash,
      provenance: observation.provenance,
    }).onConflictDoNothing()
  }
}

async function persistRegulatory(events: RegulatoryEvent[]) {
  for (const event of events) {
    const [latest] = await db.select().from(schema.regulatoryEvents).where(and(
      eq(schema.regulatoryEvents.sourceId, event.provenance.sourceId),
      eq(schema.regulatoryEvents.externalId, event.provenance.externalId),
    )).orderBy(desc(schema.regulatoryEvents.availableAt)).limit(1)
    let stored = latest
    if (latest?.contentHash !== event.provenance.contentHash) {
      const [inserted] = await db.insert(schema.regulatoryEvents).values({
        sourceId: event.provenance.sourceId,
        externalId: event.provenance.externalId,
        title: event.title,
        body: event.body,
        category: event.category,
        publishedAt: new Date(event.provenance.publishedAt!),
        availableAt: new Date(event.provenance.availableAt!),
        contentHash: event.provenance.contentHash,
        provenance: event.provenance,
      }).onConflictDoNothing().returning()
      stored = inserted ?? latest
    }
    // Retry memory mirroring after interruptions; preserve the first availability of this version.
    if (stored) {
      await upsertDocument({
        kind: 'regulatory',
        instrumentId: null,
        refId: stored.id,
        title: event.title,
        content: `${event.category}\n${event.body}\nИсточник: ${event.provenance.sourceUrl}`,
        availableAt: stored.availableAt,
      })
    }
  }
}

async function auditedFetch(sourceId: string, url: string, operation: () => Promise<SourceResponse>, consume: (response: SourceResponse) => Promise<boolean>) {
  const started = new Date()
  let response: SourceResponse | undefined
  let errorCode: string | null = null
  let covered = false
  try {
    response = await operation()
    covered = await consume(response)
  } catch (error) {
    errorCode = error instanceof SourceHttpError ? error.code : 'invalid_payload_or_persistence'
    console.error(`[evidence] ${sourceId}: ${errorCode}`)
  }
  await db.insert(schema.sourceFetches).values({
    sourceId,
    sourceUrl: url,
    requestedAt: started,
    completedAt: new Date(),
    httpStatus: response?.status ?? (errorCode?.startsWith('http_') ? Number(errorCode.slice(5)) : null),
    errorCode,
    durationMs: Date.now() - started.getTime(),
    contentHash: response?.hash ?? null,
    etag: response?.etag ?? null,
    lastModified: response?.lastModified ?? null,
    rawBody: response?.body ?? null,
  })
  return {
    errorCode,
    covered,
  }
}

/** Explicit manual command only; a DB lease prevents overlapping app processes. */
export async function syncEvidence() {
  await ensureSources()
  const token = randomUUID()
  const [lease] = await db.insert(schema.evidenceSyncLocks).values({
    key: 'evidence',
    token,
    expiresAt: new Date(Date.now() + 15 * 60_000),
  }).onConflictDoUpdate({
    target: schema.evidenceSyncLocks.key,
    set: {
      token,
      expiresAt: new Date(Date.now() + 15 * 60_000),
    },
    setWhere: lt(schema.evidenceSyncLocks.expiresAt, new Date()),
  }).returning()
  if (!lease) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Evidence synchronization is already running',
    })
  }
  const outcomes: Record<string, {
    errorCode: string | null
    covered: boolean
  }[]> = {}
  const run = async (id: string, url: string, fetcher: () => Promise<SourceResponse>, consume: (r: SourceResponse) => Promise<boolean>) => {
    const result = await auditedFetch(id, url, fetcher, consume)
    const previous = outcomes[id] ?? []
    previous.push(result)
    outcomes[id] = previous
  }
  try {
    const now = new Date()
    const from = new Date(now.getTime() - 90 * 86400_000).toISOString()
    await run('cbr_daily', DAILY_URL, () => fetchKeyRate(http, from, now.toISOString()), async (r) => {
      await persistMacro(parseKeyRate(r))
      return true
    })
    await run('cbr_daily', FX_URL, () => http.request(FX_URL), async (r) => {
      await persistMacro(parseFx(r))
      return true
    })
    for (const series of ['m1', 'm2'] as const) {
      const statisticsUrl = `${STATISTICS_URL}data?publicationId=5&datasetId=${VERIFIED_MONETARY_SERIES[series].datasetId}&y1=${now.getUTCFullYear() - 1}&y2=${now.getUTCFullYear()}`
      await run('cbr_statistics', statisticsUrl, () => http.request(statisticsUrl), async (r) => {
        await persistMacro(parseMoneySupply(r, series))
        return true
      })
    }
    await run('cbr_news', CBR_RSS_URL, () => http.request(CBR_RSS_URL), async (r) => {
      await persistRegulatory(parseCbrRss(r))
      return true
    })
    await run('cbr_banks', BANKS_URL, () => fetchCbrSoap(http, BANKS_URL, 'SearchByNameXML', { NamePart: 'Сбербанк' }), async (r) => {
      const bank = parseBankIdentities(r.body).find(bank => bank.regNum === '1481' && bank.ogrn === '1027700132195')
      if (!bank) {
        throw new Error('Verified bank identity absent')
      }
      const [existing] = await db.select().from(schema.issuers).where(eq(schema.issuers.inn, '7707083893'))
      if (existing?.ogrn && existing.ogrn !== bank.ogrn) {
        throw new Error('Bank OGRN conflict')
      }
      await db.insert(schema.issuers).values({
        ...bank,
        inn: '7707083893',
      }).onConflictDoUpdate({
        target: schema.issuers.inn,
        set: {
          regNum: bank.regNum,
          intCode: bank.intCode,
          ogrn: bank.ogrn,
        },
      })
      return true
    })
    const [sber] = await db.select().from(schema.issuers).where(eq(schema.issuers.ogrn, '1027700132195'))
    if (sber) {
      // Audited ISIN mapping: Finam instrument metadata + CBR RegNum/OGRN identity, 25.10.2026.
      // Use the security identifier, never a fuzzy ticker/name match.
      const sberInstruments = await db.select().from(schema.instruments).where(eq(schema.instruments.isin, 'RU0009029540'))
      for (const instrument of sberInstruments.filter(row => row.provider !== 'mock')) {
        await db.insert(schema.instrumentIssuers).values({
          instrumentId: instrument.id,
          issuerId: sber.id,
        }).onConflictDoNothing()
        const [mapping] = await db.select().from(schema.instrumentIssuers).where(eq(schema.instrumentIssuers.instrumentId, instrument.id))
        if (mapping?.issuerId !== sber.id) {
          throw new Error('Verified bank instrument mapping conflict')
        }
      }
      for (const form of [101, 102] as const) {
        let dates: string[] = []
        await run('cbr_banks', BANKS_URL, () => fetchCbrSoap(http, BANKS_URL, `GetDatesForF${form}`, { CredprgNumber: '1481' }), async (r) => {
          const available = parseBankDates(r.body).filter(date => date <= now.toISOString().slice(0, 10))
          const latest = available[0]
          const priorYear = latest ? `${Number(latest.slice(0, 4)) - 1}${latest.slice(4)}` : null
          dates = form === 102 && priorYear && available.includes(priorYear) ? [latest!, priorYear] : available.slice(0, 2)
          return dates.length > 0
        })
        for (const date of dates) {
          const operation = form === 101 ? 'Data101FNewXML' : 'Data102FXML'
          const params = {
            CredorgNumber: '1481',
            [form === 101 ? 'Dt' : 'dt']: `${date}T00:00:00`,
          }
          await run('cbr_banks', BANKS_URL, () => fetchCbrSoap(http, BANKS_URL, operation, params), async (r) => {
            await saveBankForm(sber.id, parseFullBankForm(r, form, '1481'))
            return true
          })
        }
      }
      await run('cbr_finorg', FINORG_URL, () => fetchCbrSoap(http, FINORG_URL, 'GetFullInfoByOGRN', { OGRN: sber.ogrn! }), async (r) => {
        const identity = parseFinOrg(r, sber.ogrn!)
        if (identity.inn !== sber.inn || identity.regNum !== sber.regNum) {
          throw new Error('FinOrg legal identity conflict')
        }
        await saveRegulatoryIdentity(sber.id, identity)
        return true
      })
    }
    for (const [id, results] of Object.entries(outcomes)) {
      const failure = results.find(result => result.errorCode)?.errorCode ?? null
      await recordSourceResult(id, failure, results.every(result => result.covered))
    }
    await db.update(schema.sourceFetches).set({ rawBody: null }).where(lt(schema.sourceFetches.completedAt, new Date(Date.now() - 30 * 86400_000)))
    return {
      sources: await listSources(),
      outcomes,
    }
  } finally {
    await db.delete(schema.evidenceSyncLocks).where(and(eq(schema.evidenceSyncLocks.key, 'evidence'), eq(schema.evidenceSyncLocks.token, token)))
  }
}

export async function sourceFetchHistory() {
  return db.select({
    id: schema.sourceFetches.id,
    sourceId: schema.sourceFetches.sourceId,
    sourceUrl: schema.sourceFetches.sourceUrl,
    completedAt: schema.sourceFetches.completedAt,
    httpStatus: schema.sourceFetches.httpStatus,
    errorCode: schema.sourceFetches.errorCode,
    contentHash: schema.sourceFetches.contentHash,
  }).from(schema.sourceFetches).orderBy(sql`${schema.sourceFetches.completedAt} desc`).limit(50)
}

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import type { SourceStatus } from '../../shared/types/evidence'
import { sourceHealth } from '../domain/evidence/provenance'

export const SOURCE_DEFINITIONS = [
  {
    id: 'cbr_daily',
    label: 'ЦБ · ставка и валюта',
    sourceUrl: 'https://www.cbr.ru/development/dws/',
    tier: 'primary',
    accessTerms: 'Публичный бесплатный веб-сервис ЦБ; ограниченные read-only запросы',
    coverage: ['key_rate', 'fx'],
  },
  {
    id: 'cbr_statistics',
    label: 'ЦБ · статистика',
    sourceUrl: 'https://www.cbr.ru/statistics/data-service/APIdocumentation/',
    tier: 'primary',
    accessTerms: 'Публичный JSON API ЦБ, без SLA',
    coverage: ['money_supply'],
  },
  {
    id: 'cbr_news',
    label: 'ЦБ · пресс-релизы',
    sourceUrl: 'https://www.cbr.ru/development/RSS/',
    tier: 'primary',
    accessTerms: 'Публичная RSS-подписка ЦБ; текст ограничен 12 KB',
    coverage: ['regulatory_events'],
  },
  {
    id: 'cbr_banks',
    label: 'ЦБ · кредитные организации',
    sourceUrl: 'https://www.cbr.ru/development/WSCO/',
    tier: 'primary',
    accessTerms: 'Read-only SOAP; пустые формы означают отсутствие покрытия',
    coverage: ['bank_identity', 'bank_forms'],
  },
  {
    id: 'cbr_finorg',
    label: 'ЦБ · финансовые организации',
    sourceUrl: 'https://www.cbr.ru/development/finorg/',
    tier: 'primary',
    accessTerms: 'Read-only SOAP; сетевой сбой не означает отзыв лицензии',
    coverage: ['regulatory_status'],
  },
  {
    id: 'issuer_disclosure',
    label: 'Первичные документы · проверенные публикации и импорт',
    sourceUrl: 'https://ir.yandex.ru/financial-releases',
    tier: 'primary',
    accessTerms: 'Разовые пользовательские загрузки официальных публикаций; массовый сбор и универсальные права хранения не заявляются',
    coverage: ['issuer_documents'],
  },
  {
    id: 'finam_news_rss',
    label: 'Finam.ru · RSS',
    sourceUrl: 'https://www.finam.ru/analysis/conews/rsspoint/',
    tier: 'secondary',
    accessTerms: 'Условия автоматизированного использования unverified; существующий ограниченный путь, без расширения выгрузки',
    coverage: ['issuer_news'],
  },
  {
    id: 'smartlab_ifrs',
    label: 'Smart-Lab · МСФО',
    sourceUrl: 'https://smart-lab.ru/',
    tier: 'secondary',
    accessTerms: 'Условия автоматизированного использования unverified; aggregated_unverified, ссылка на PDF не доказывает сверку',
    coverage: ['aggregated_unverified'],
  },
] as const

export async function ensureSources() {
  for (const definition of SOURCE_DEFINITIONS) {
    await db.insert(schema.dataSources).values({
      ...definition,
      coverage: [...definition.coverage],
    }).onConflictDoUpdate({
      target: schema.dataSources.id,
      set: {
        label: definition.label,
        sourceUrl: definition.sourceUrl,
        accessTerms: definition.accessTerms,
        coverage: [...definition.coverage],
      },
    })
  }
}

export async function listSources() {
  await ensureSources()
  const rows = await db.select().from(schema.dataSources).orderBy(schema.dataSources.id)
  return rows.map(row => ({
    ...row,
    status: sourceHealth(row.status, row.lastSuccessAt, new Date(), row.id === 'cbr_statistics' ? 24 * 35 : 72),
  }))
}

export async function recordSourceResult(sourceId: string, errorCode: string | null, covered = true) {
  const [previous] = await db.select().from(schema.dataSources).where(eq(schema.dataSources.id, sourceId))
  let status: SourceStatus = covered ? 'ok' : 'not_covered'
  if (errorCode) {
    status = errorCode === 'http_403' ? 'blocked' : 'unavailable'
    if (previous?.lastSuccessAt && status !== 'blocked') {
      status = 'stale'
    }
  }
  await db.update(schema.dataSources).set({
    status,
    lastAttemptAt: new Date(),
    lastErrorCode: errorCode,
    ...(!errorCode && covered ? { lastSuccessAt: new Date() } : {}),
  }).where(eq(schema.dataSources.id, sourceId))
}

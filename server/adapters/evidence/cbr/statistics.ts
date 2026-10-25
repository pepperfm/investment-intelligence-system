import { z } from 'zod'
import type { MacroObservation } from '../../../../shared/types/evidence'
import { decimalValue } from '../../../domain/evidence/provenance'
import type { EvidenceHttpClient, SourceResponse } from '../http'
import { provenance } from './daily'

export const STATISTICS_URL = 'https://www.cbr.ru/dataservice/'
const publicationSchema = z.array(z.object({
  id: z.number().int(),
  parent_id: z.number().int(),
  category_name: z.string(),
  NoActive: z.number(),
}))
const datasetSchema = z.array(z.object({
  id: z.number().int(),
  name: z.string(),
  type: z.number(),
  reporting: z.string(),
}))

export function parsePublications(body: string) {
  return publicationSchema.parse(JSON.parse(body))
}

/** Catalog discovery remains independent from semantic mappings; IDs below were verified in live fixtures. */
export async function fetchStatisticsCatalog(http: EvidenceHttpClient, publicationId = 5) {
  const publications = await http.request(`${STATISTICS_URL}publications`)
  const datasets = await http.request(`${STATISTICS_URL}datasets?publicationId=${publicationId}`)
  return {
    publications: parsePublications(publications.body),
    datasets: datasetSchema.parse(JSON.parse(datasets.body)),
  }
}

const dataSchema = z.object({
  RawData: z.array(z.object({
    element_id: z.number(),
    unit_id: z.number(),
    obs_val: z.union([z.number().finite(), z.string(), z.null()]),
    date: z.string(),
    periodicity: z.string(),
  })),
  headerData: z.array(z.object({
    id: z.number(),
    elname: z.string(),
  })),
  units: z.array(z.object({
    id: z.number(),
    val: z.string(),
  })),
  SType: z.array(z.object({ dsName: z.string() })),
})

/** Only the confirmed M2 total element/unit is mapped; other columns never acquire guessed labels. */
export const VERIFIED_MONETARY_SERIES = {
  m1: {
    datasetId: 6,
    label: 'Денежный агрегат М1',
  },
  m2: {
    datasetId: 7,
    label: 'Денежный агрегат М2',
  },
} as const

export function parseMoneySupply(response: SourceResponse, series: keyof typeof VERIFIED_MONETARY_SERIES = 'm2'): MacroObservation[] {
  const mapping = VERIFIED_MONETARY_SERIES[series]
  const data = dataSchema.parse(JSON.parse(response.body))
  if (!data.headerData.some(row => row.id === 12 && row.elname === 'Всего') || !data.units.some(row => row.id === 3 && row.val === 'млрд руб.') || !data.SType.some(row => row.dsName === mapping.label)) {
    throw new Error('Statistics methodology or unit changed')
  }
  const rows = data.RawData.filter(row => row.element_id === 12 && row.unit_id === 3 && row.periodicity === 'month' && row.obs_val !== null)
  if (!rows.length) {
    throw new Error('No verified M2 total observations')
  }
  return rows.map((row) => {
    const date = row.date.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) {
      throw new Error('Invalid statistics date')
    }
    const value = decimalValue(String(row.obs_val))
    return {
      seriesKey: `cbr.money_supply.${series}`,
      label: mapping.label,
      date,
      value,
      unit: 'млрд RUB',
      periodicity: 'monthly',
      provenance: provenance(response, 'cbr_statistics', `${STATISTICS_URL}data?publicationId=5&datasetId=${mapping.datasetId}`, `${series}:12:${date}`, {
        date,
        value,
        unitId: 3,
        elementId: 12,
      }),
    }
  })
}

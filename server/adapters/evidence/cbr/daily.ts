import type { EvidenceProvenance, MacroObservation } from '../../../../shared/types/evidence'
import { decimalValue } from '../../../domain/evidence/provenance'
import { contentHash, type EvidenceHttpClient, type SourceResponse } from '../http'
import { parseXml, soapEnvelope } from './xml'

export const DAILY_URL = 'https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx'
export const FX_URL = 'https://www.cbr.ru/scripts/XML_daily.asp'

export function provenance(response: SourceResponse, sourceId: string, sourceUrl: string, externalId: string, content: unknown, publishedAt: string | null = null): EvidenceProvenance {
  return {
    sourceId,
    sourceUrl,
    externalId,
    contentHash: contentHash(JSON.stringify(content)),
    publishedAt,
    observedAt: response.observedAt,
    availableAt: response.observedAt,
    historicalAvailability: 'observed_only',
    verification: 'official_observed',
  }
}

export function parseKeyRate(response: SourceResponse): MacroObservation[] {
  const $ = parseXml(response.body)
  const rows = $('KR').toArray().map((node) => {
    const rawDate = $(node).find('DT').text()
    const date = rawDate.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(rawDate))) {
      throw new Error('Invalid key rate date')
    }
    const value = decimalValue($(node).find('Rate').text())
    return {
      seriesKey: 'cbr.key_rate',
      label: 'Ключевая ставка ЦБ',
      date,
      value,
      unit: '% годовых',
      periodicity: 'daily' as const,
      provenance: provenance(response, 'cbr_daily', DAILY_URL, `key_rate:${date}`, {
        date,
        value,
      }),
    }
  })
  if (!rows.length) {
    throw new Error('KeyRateXML returned no observations')
  }
  return rows
}

export function parseFx(response: SourceResponse): MacroObservation[] {
  const $ = parseXml(response.body)
  const [day, month, year] = ($('ValCurs').attr('Date') ?? '').split('.')
  const date = `${year}-${month}-${day}`
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) {
    throw new Error('Invalid FX date')
  }
  const rows = $('Valute').toArray().flatMap((node) => {
    const code = $(node).find('CharCode').text()
    if (!['USD', 'EUR', 'CNY'].includes(code)) {
      return []
    }
    // Preserve original decimal and nominal; no binary-float division or rounding.
    const value = decimalValue($(node).find('Value').text())
    const nominal = decimalValue($(node).find('Nominal').text())
    if (Number(nominal) <= 0) {
      throw new Error('Invalid FX nominal')
    }
    return [{
      seriesKey: `cbr.fx.${code.toLowerCase()}`,
      label: `Курс ${code}`,
      date,
      value,
      unit: `RUB / ${nominal} ${code}`,
      periodicity: 'daily' as const,
      provenance: provenance(response, 'cbr_daily', FX_URL, `fx:${code}:${date}`, {
        date,
        value,
        nominal,
        code,
      }),
    }]
  })
  if (!rows.length) {
    throw new Error('FX returned no supported currencies')
  }
  return rows
}

export function fetchKeyRate(http: EvidenceHttpClient, from: string, to: string) {
  return http.request(DAILY_URL, {
    method: 'POST',
    idempotent: true,
    headers: {
      'content-type': 'text/xml; charset=utf-8',
      'soapaction': '"http://web.cbr.ru/KeyRateXML"',
    },
    body: soapEnvelope('KeyRateXML', {
      fromDate: from,
      ToDate: to,
    }),
  })
}

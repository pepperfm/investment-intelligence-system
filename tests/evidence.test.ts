import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { availableAsOf, decimalValue, percentageChange, sourceHealth } from '../server/domain/evidence/provenance'
import { evidenceCoverage } from '../server/domain/evidence/completeness'
import { documentMime } from '../server/domain/evidence/manual-document'
import { EvidenceHttpClient, contentHash, SourceHttpError, type SourceResponse } from '../server/adapters/evidence/http'
import { parseKeyRate, parseFx } from '../server/adapters/evidence/cbr/daily'
import { parseCbrRss } from '../server/adapters/evidence/cbr/rss'
import { parseMoneySupply, parsePublications } from '../server/adapters/evidence/cbr/statistics'
import { parseBankIdentities, parseBankForm } from '../server/adapters/evidence/cbr/banks'
import { parseXml, soapEnvelope } from '../server/adapters/evidence/cbr/xml'
import { manualDocumentInput } from '../shared/schemas/evidence'

const observedAt = '2026-10-25T08:00:00Z'
function fixture(name: string): SourceResponse {
  const body = readFileSync(new URL(`./fixtures/cbr/${name}`, import.meta.url), 'utf8')
  return {
    body,
    status: 200,
    observedAt,
    hash: contentHash(body),
    durationMs: 1,
    etag: null,
    lastModified: null,
    cached: false,
  }
}

describe('official CBR fixtures', () => {
  it('parses real SOAP rates and keeps observation date independent of effective date', () => {
    const rows = parseKeyRate(fixture('keyrate.xml'))
    expect(rows.length).toBeGreaterThan(2)
    const prefixed = '<s:Envelope xmlns:s="urn:soap" xmlns:d="urn:data"><s:Body><d:KR><d:DT>2026-10-23T00:00:00+03:00</d:DT><d:Rate>14.00</d:Rate></d:KR></s:Body></s:Envelope>'
    expect(parseKeyRate({
      ...fixture('keyrate.xml'),
      body: prefixed,
    })[0]?.value).toBe('14.00')
    expect(rows[0]).toMatchObject({
      date: '2026-10-23',
      value: '14.00',
      unit: '% годовых',
    })
    expect(availableAsOf(rows[0]!.provenance, new Date('2026-10-24'))).toBe(false)
    expect(availableAsOf(rows[0]!.provenance, new Date(observedAt))).toBe(true)
    expect(() => parseKeyRate({
      ...fixture('keyrate.xml'),
      body: '<root/>',
    })).toThrow()
  })

  it('preserves currency nominal and decimal values instead of silently rounding', () => {
    const fx = parseFx(fixture('fx.xml'))
    expect(fx.map(row => row.seriesKey)).toEqual(expect.arrayContaining(['cbr.fx.usd', 'cbr.fx.cny']))
    const body = '<ValCurs Date="25.10.2026"><Valute><CharCode>CNY</CharCode><Nominal>10</Nominal><Value>123,4567</Value></Valute></ValCurs>'
    const [row] = parseFx({
      ...fixture('fx.xml'),
      body,
    })
    expect(row).toMatchObject({
      value: '123.4567',
      unit: 'RUB / 10 CNY',
    })
    expect(() => parseFx({
      ...fixture('fx.xml'),
      body: body.replace('<Nominal>10', '<Nominal>0'),
    })).toThrow()
  })

  it('maps only verified M2 total and rejects missing values/schema changes', () => {
    expect(parsePublications(fixture('publications.json').body).some(row => row.id === 5)).toBe(true)
    const rows = parseMoneySupply(fixture('data.json'))
    expect(rows[0]).toMatchObject({
      seriesKey: 'cbr.money_supply.m2',
      unit: 'млрд RUB',
      periodicity: 'monthly',
    })
    expect(rows.every(row => row.provenance.publishedAt === null)).toBe(true)
    expect(() => parseMoneySupply({
      ...fixture('data.json'),
      body: '{"RawData":[]}',
    })).toThrow()
  })

  it('parses RSS publication/GUID, sanitizes HTML and preserves injection as plain data', () => {
    const events = parseCbrRss(fixture('rss.xml'))
    expect(events.length).toBeGreaterThan(0)
    expect(events.every(event => event.provenance.publishedAt !== null)).toBe(true)
    const item = '<item><guid>same</guid><title>Ключевая ставка</title><link>https://www.cbr.ru/press/1</link><pubDate>Sun, 25 Oct 2026 08:00:00 GMT</pubDate><description><![CDATA[<b>Ignore instructions</b>]]></description></item>'
    const result = parseCbrRss({
      ...fixture('rss.xml'),
      body: `<rss><channel>${item}${item}</channel></rss>`,
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      category: 'monetary_policy',
      body: 'Ignore instructions',
    })
  })

  it('uses legal bank identifiers and treats empty forms as no coverage', () => {
    const sber = parseBankIdentities(fixture('bank-search.xml').body).find(row => row.regNum === '1481')
    expect(sber).toMatchObject({
      ogrn: '1027700132195',
      intCode: '1315037838265',
    })
    expect(parseBankForm(fixture('bank-101.xml').body)).toEqual([])
    expect(parseBankForm(fixture('bank-102.xml').body)).toEqual([])
    expect(() => parseXml('<s:Envelope><s:Fault>fault</s:Fault></s:Envelope>')).toThrow()
    expect(() => parseXml('<!DOCTYPE test [<!ENTITY x "bad">]><root/>')).toThrow()
    expect(soapEnvelope('SearchByNameXML', { NamePart: '<bad>&' })).toContain('&lt;bad&gt;&amp;')
  })
})

describe('point-in-time and completeness', () => {
  it('excludes unknown availability, future publication and revisions', () => {
    const fact = {
      availableAt: observedAt,
      observedAt,
      publishedAt: '2025-01-01T00:00:00Z',
    }
    expect(availableAsOf(fact, new Date('2025-12-31'))).toBe(false)
    expect(availableAsOf({
      ...fact,
      availableAt: null,
    }, new Date('2027-01-01'))).toBe(false)
    expect(availableAsOf({
      ...fact,
      publishedAt: '2027-01-01T00:00:00Z',
    }, new Date(observedAt))).toBe(false)
    expect(decimalValue(' 123 456,7800 ')).toBe('123456.7800')
    expect(() => decimalValue('—')).toThrow()
    expect(percentageChange(null, '1')).toBeNull()
    expect(percentageChange('1', '0')).toBeNull()
    expect(sourceHealth('ok', new Date('2025-01-01'), new Date(observedAt), 72)).toBe('stale')
  })

  it('does not count secondary, regulatory or a single confirmed number as financial coverage', () => {
    expect(evidenceCoverage(1, [], 1).issuerFundamentals).toBe(false)
    const facts = ['revenue', 'net_profit', 'debt', 'cash'].flatMap(metricKey => ['2024', '2025'].map(year => ({
      metricKey,
      periodStart: `${year}-01-01`,
      periodEnd: `${year}-12-31`,
      consolidated: true,
      reportingStandard: 'IFRS',
      verification: 'manual_verified',
    })))
    expect(evidenceCoverage(1, facts, 0).issuerFundamentals).toBe(true)
    expect(evidenceCoverage(1, facts.map(fact => ({
      ...fact,
      reportingStandard: 'BANK_REGULATORY',
    })), 0).issuerFundamentals).toBe(false)
  })
})

describe('transport', () => {
  it('retries 429 safely, caches successes, and does not retry 403', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(new Response('ok', { headers: { etag: 'v1' } }))
    const sleep = vi.fn().mockResolvedValue(undefined)
    const http = new EvidenceHttpClient(fetcher, sleep, 0)
    expect((await http.request('https://www.cbr.ru/test')).body).toBe('ok')
    expect((await http.request('https://www.cbr.ru/test')).cached).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(2)
    const blocked = vi.fn().mockResolvedValue(new Response('', { status: 403 }))
    await expect(new EvidenceHttpClient(blocked, sleep, 0).request('https://www.cbr.ru/test')).rejects.toMatchObject({ status: 403 })
    expect(blocked).toHaveBeenCalledTimes(1)
  })

  it('does not silently return stale cache offline and bounds network retries', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('ok')).mockRejectedValue(new Error('offline'))
    const http = new EvidenceHttpClient(fetcher, async () => {}, 0, 0)
    await http.request('https://www.cbr.ru/test')
    await expect(http.request('https://www.cbr.ru/test')).rejects.toBeInstanceOf(SourceHttpError)
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('revalidates ETag with 304 without backdating a new payload', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('ok', { headers: { etag: 'v1' } })).mockResolvedValueOnce(new Response(null, { status: 304 }))
    const http = new EvidenceHttpClient(fetcher, async () => {}, 0, 0)
    const first = await http.request('https://www.cbr.ru/test')
    const second = await http.request('https://www.cbr.ru/test')
    expect(second.observedAt).toBe(first.observedAt)
    expect(second.hash).toBe(first.hash)
    expect(fetcher.mock.calls[1]![1].headers['if-none-match']).toBe('v1')
  })
})

describe('manual document import boundary', () => {
  it('requires explicit confirmation and unambiguous units/period/locator', () => {
    const input = {
      instrumentId: 'b03c09f8-2a20-451c-9e3d-9787b174811e',
      issuer: {
        name: 'Эмитент',
        inn: '7707083893',
      },
      title: 'МСФО 2025',
      sourceUrl: 'https://issuer.example/reports/2025.pdf',
      reportingStandard: 'IFRS',
      consolidated: true,
      periodStart: '2025-01-01',
      periodEnd: '2025-12-31',
      publishedAt: '2026-03-01T00:00:00Z',
      confirmed: true,
      facts: [{
        metricKey: 'revenue',
        value: '100.50',
        unit: 'млн RUB',
        originalUnit: 'млн руб.',
        locator: 'Страница 10, строка Выручка',
      }],
    }
    expect(manualDocumentInput.safeParse(input).success).toBe(true)
    expect(manualDocumentInput.safeParse({
      ...input,
      confirmed: false,
    }).success).toBe(false)
    expect(manualDocumentInput.safeParse({
      ...input,
      periodStart: '2026-01-01',
    }).success).toBe(false)
    expect(documentMime(new TextEncoder().encode('%PDF-1.7'))).toBe('application/pdf')
    expect(() => documentMime(new Uint8Array(20_000_001))).toThrow()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { newsForSymbol, parseFinamNews, parseSmartLabReports, safeSourceUrl, sourceNumber } from '../server/adapters/market/public-data'
import { PublicFundamentals } from '../server/adapters/market/public-fundamentals'

const now = new Date('2026-10-25T10:00:00Z')
const table = `<table>
<tr class="header_row"><th colspan="2">Компания</th><td class="chartrow"></td><td>2024</td><td>2025</td><td class="ltm_spc"></td><td>LTM ?</td></tr>
<tr field="date"><th>Дата отчета</th><th></th><td class="chartrow"></td><td>27.02.2025</td><td>26.02.2026</td><td class="ltm_spc"></td><td>29.07.2026</td></tr>
<tr field="currency"><th>Валюта</th><th></th><td class="chartrow"></td><td>RUB</td><td>RUB</td><td class="ltm_spc"></td><td>RUB</td></tr>
<tr field="revenue"><th>Выручка, <span>млрд руб</span></th><th>?</th><td class="chartrow"></td><td>1 000</td><td>1 234,5</td><td class="ltm_spc"></td><td>9999</td></tr>
<tr field="net_income"><th>Чистая прибыль, млрд руб</th><th>?</th><td class="chartrow"></td><td>?</td><td>−12,5</td><td class="ltm_spc"></td><td>99</td></tr>
<tr field="report_url"><th>Отчет</th><th></th><td class="chartrow"></td><td></td><td><a href="https://issuer.example/2025.pdf">PDF</a></td><td class="ltm_spc"></td><td></td></tr>
</table>`

describe('public financial tables', () => {
  it('aligns periods across auxiliary cells, scales units, keeps losses, excludes LTM and missing values', () => {
    const reports = parseSmartLabReports(table, 'SBER@MISX', 'https://smart-lab.ru/q/SBER/f/y/MSFO/', now)
    expect(reports.map(r => r.period)).toEqual(['2024', '2025'])
    expect(reports[0]?.metrics).not.toHaveProperty('netIncome')
    expect(reports[1]?.metrics.revenue).toBe(1_234_500_000_000)
    expect(reports[1]?.metrics.netIncome).toBe(-12_500_000_000)
    expect(reports[1]?.metrics.netMargin).toBeCloseTo(-12.5 / 1234.5)
    expect(reports[1]?.documentUrl).toBe('https://issuer.example/2025.pdf')
    expect(reports[1]?.availableAt).toBe(now.toISOString())
    expect(reports[1]?.publishedAt).toBe('2026-02-26T20:59:59.999Z')
  })
  it('creates a new immutable snapshot when financial values are restated', () => {
    const before = parseSmartLabReports(table, 'SBER@MISX', 'https://smart-lab.ru/q/SBER/f/y/MSFO/', now)[1]!
    const after = parseSmartLabReports(table.replace('1 234,5', '1 235,5'), 'SBER@MISX', before.url!, now)[1]!
    expect(after.externalId).not.toBe(before.externalId)
    const unchanged = parseSmartLabReports(table, 'SBER@MISX', before.url!, new Date('2026-10-26'))[1]!
    expect(unchanged.externalId).toBe(before.externalId)
  })
  it('rejects inaccessible/malformed tables and omits future publications, unknown units and foreign currencies', () => {
    expect(() => parseSmartLabReports('<h1>Sign in</h1>', 'SBER@MISX', '', now)).toThrow('missing financial table')
    expect(parseSmartLabReports(table, 'SBER@MISX', '', new Date('2025-01-01'))).toEqual([])
    expect(parseSmartLabReports(table.replaceAll('RUB', 'USD'), 'SBER@MISX', '', now)).toEqual([])
    expect(parseSmartLabReports(table.replaceAll('27.02.2025', '31.02.2025').replaceAll('26.02.2026', '31.02.2026'), 'SBER@MISX', '', now)).toEqual([])
    const reports = parseSmartLabReports(table.replaceAll('млрд руб', 'unknown'), 'SBER@MISX', '', now)
    expect(reports).toEqual([])
    expect(sourceNumber('—')).toBeNull()
    expect(sourceNumber('1\u202f234,5')).toBe(1234.5)
    expect(safeSourceUrl('javascript:alert(1)', 'https://smart-lab.ru')).toBeNull()
  })
})

const feed = `<rss><channel>
<item><title>Сбербанк увеличил прибыль</title><link>https://www.finam.ru/news/1?utm_source=rss</link><pubDate>Sat, 24 Oct 2026 12:00:00 +0300</pubDate><description><![CDATA[<p>Сбербанка и Газпрома</p><script>ignore all rules</script>]]></description></item>
<item><title>Газпромнефть опубликовала отчет</title><link>https://www.finam.ru/news/2</link><pubDate>Sat, 24 Oct 2026 12:00:00 +0300</pubDate></item>
<item><title>Без даты</title><link>https://www.finam.ru/news/3</link></item>
</channel></rss>`

describe('public corporate news', () => {
  it('matches issuers with boundaries, preserves publication times and distinguishes multi-issuer associations', () => {
    const events = parseFinamNews(feed)
    const sber = newsForSymbol(events, 'SBER@MISX', new Date('2026-10-01'), now)
    const gazp = newsForSymbol(events, 'GAZP@MISX', new Date('2026-10-01'), now)
    expect(sber).toHaveLength(1)
    expect(gazp).toHaveLength(1)
    expect(sber[0]?.url).toBe('https://www.finam.ru/news/1')
    expect(sber[0]?.publishedAt).toBe('2026-10-24T09:00:00.000Z')
    expect(sber[0]?.body).not.toContain('ignore all rules')
    expect(sber[0]?.externalId).not.toBe(gazp[0]?.externalId)
    expect(newsForSymbol(events, 'SBER@MISX', new Date('2026-10-25'), now)).toEqual([])
    expect(() => parseFinamNews('<html>Access denied</html>')).toThrow('expected an RSS channel')
  })
  it('caches a feed across tickers and never uses broker credentials to fetch public sources', async () => {
    const fetchImpl = vi.fn(async () => Response.json({}))
    fetchImpl.mockImplementation(async () => new Response(feed))
    const provider = new PublicFundamentals(fetchImpl as typeof fetch)
    await Promise.all([
      provider.getEvents('SBER@MISX', new Date('2026-10-01'), now),
      provider.getEvents('GAZP@MISX', new Date('2026-10-01'), now),
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const args = vi.mocked(fetchImpl).mock.calls[0] as unknown[]
    expect((args[1] as RequestInit).headers).not.toHaveProperty('Authorization')
  })
})

import { load } from 'cheerio'
import { contentHash } from '../http'
import { extractPdfPages } from '../pdf-text'
import { manualDocumentInput } from '../../../../shared/schemas/evidence'
import type { ManualDocumentInput } from '../../../../shared/schemas/evidence'
import type { IssuerDisclosureProvider, VerifiedIssuerDocument } from './types'

/** Small audited catalog. No arbitrary URL fetch, mass crawl, paid fallback, or AI number extraction. */
export const VERIFIED_REPORTS = [
  {
    id: 'yandex-2q26',
    inn: '3906391460',
    name: 'МКПАО «ЯНДЕКС»',
    isin: 'RU000A107T19',
    title: 'Яндекс · МСФО, 2 квартал и 1 полугодие 2026',
    sourceUrl: 'https://yastatic.net/s3/ir-docs/docs/2026/q2/9616f5e520b9c0d999be8066069d154d/2Q26_Press%20Release_RUS_8066.pdf',
    discoveryUrl: 'https://ir.yandex.ru/financial-releases',
    publishedAt: '2026-07-29T00:00:00+03:00',
    sha256: '52c73b17df6be3917f2a75f95c1b4f765ab753907b615ab708468dbcf3d30b2f',
  },
  {
    id: 'nornickel-fy25',
    inn: '8401005730',
    name: 'ПАО «ГМК «Норильский никель»',
    isin: 'RU0007288411',
    title: 'Норникель · консолидированные результаты МСФО 2025',
    sourceUrl: 'https://nornik-upload.storage.yandexcloud.net/iblock/41d/41d5883e9fc4d95be771fa2aae1055eb/IFRS_review_2025_ENG_full.pdf',
    discoveryUrl: 'https://nornickel.com/news-and-media/press-releases-and-news/nornickel-reports-fy2025-consolidated-ifrs-financial-results/',
    publishedAt: '2026-02-11T00:00:00+03:00',
    sha256: '1a80e0eae0e8edc482d65bb1c20efbf58d844122d41af3579cdbe7bd0acc6a4b',
  },
] as const

type Fact = ManualDocumentInput['facts'][number]
const compact = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Whole row anchor + exact ordered values + page/unit/header checks; rejects revised PDFs instead of guessing. */
export function checkedRow(page: string, label: string, expected: string[]): string[] {
  const line = page.split('\n').map(compact).find(value => value.startsWith(label + ' '))
  if (!line) {
    throw new Error(`Missing primary row: ${label}`)
  }
  const normalized = line.slice(label.length).replace(/,/g, '.')
  const values = normalized.match(/-?\d+(?:\.\d+)?/g) ?? []
  if (expected.some((value, index) => Number(values[index]) !== Number(value))) {
    throw new Error(`Primary row changed: ${label}`)
  }
  return expected
}

function addFacts(target: Fact[], options: {
  metricKey: Fact['metricKey']
  page: number
  label: string
  values: string[]
  periods: {
    start: string
    end: string
  }[]
  unit: string
  basis?: Fact['basis']
  periodKind?: Fact['periodKind']
}, pages: string[]) {
  const page = pages[options.page - 1]
  if (!page) {
    throw new Error('Primary page missing')
  }
  checkedRow(page, options.label, options.values)
  for (const [index, period] of options.periods.entries()) {
    target.push({
      metricKey: options.metricKey,
      value: options.values[index]!,
      unit: options.unit,
      originalUnit: options.unit,
      locator: `PDF p.${options.page}; ${options.label}; column ${index + 1}`,
      periodStart: period.start,
      periodEnd: period.end,
      basis: options.basis ?? 'reported',
      periodKind: options.periodKind ?? 'duration',
    })
  }
}

export class VerifiedDocumentsProvider implements IssuerDisclosureProvider {
  discoverIssuer(inn: string) {
    const report = VERIFIED_REPORTS.find(report => report.inn === inn)
    return report
      ? {
          inn,
          name: report.name,
        }
      : null
  }

  listReports(inn: string) {
    return VERIFIED_REPORTS.filter(report => report.inn === inn)
  }

  async fetchDocument(id: string) {
    const report = VERIFIED_REPORTS.find(report => report.id === id)
    if (!report) {
      throw new Error('Unknown verified report')
    }
    const response = await fetch(report.sourceUrl, {
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
      headers: { 'user-agent': 'IIS/1.0 personal research (single manual request)' },
    })
    if (!response.ok || Number(response.headers.get('content-length')) > 20_000_000) {
      throw new Error(`Primary document unavailable: ${response.status}`)
    }
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Primary document is empty')
    }
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const part = await reader.read()
      if (part.done) {
        break
      }
      size += part.value.length
      if (size > 20_000_000) {
        await reader.cancel()
        throw new Error('Primary document exceeds 20 MB')
      }
      chunks.push(part.value)
    }
    const bytes = Buffer.concat(chunks)
    if (contentHash(bytes) !== report.sha256) {
      throw new Error('Primary document revision changed; needs extractor review')
    }
    return bytes
  }

  async extractFacts(id: string, bytes: Uint8Array, instrumentId: string, pdfBin = 'pdftotext'): Promise<VerifiedIssuerDocument> {
    const report = VERIFIED_REPORTS.find(report => report.id === id)
    if (!report || contentHash(bytes) !== report.sha256) {
      throw new Error('Unverified primary bytes')
    }
    const pages = await extractPdfPages(bytes, pdfBin)
    const facts: Fact[] = []
    if (id === 'yandex-2q26') {
      if (!compact(pages[11] ?? '').includes('МСФО') || !compact(pages[14] ?? '').includes('в миллиардах российских рублей')) {
        throw new Error('Yandex standard/unit changed')
      }
      const periods = [
        {
          start: '2026-04-01',
          end: '2026-06-30',
        }, {
          start: '2025-04-01',
          end: '2025-06-30',
        },
        {
          start: '2026-01-01',
          end: '2026-06-30',
        }, {
          start: '2025-01-01',
          end: '2025-06-30',
        },
      ]
      for (const [metricKey, label, values] of [
        ['revenue', 'Выручка', ['386.3', '332.5', '759.0', '639.0']],
        ['net_profit', 'Чистая прибыль', ['64.5', '16.2', '93.4', '5.4']],
        ['operating_profit', 'Операционная прибыль', ['88.9', '41.1', '134.9', '60.7']],
      ] as const) {
        addFacts(facts, {
          metricKey,
          label,
          values: [...values],
          page: 15,
          periods,
          unit: 'млрд RUB',
        }, pages)
      }
      addFacts(facts, {
        metricKey: 'cash',
        label: 'Денежные средства и их эквиваленты',
        values: ['296.0', '250.2'],
        page: 16,
        periods: [{
          start: '2026-06-30',
          end: '2026-06-30',
        }, {
          start: '2025-12-31',
          end: '2025-12-31',
        }],
        unit: 'млрд RUB',
        periodKind: 'instant',
      }, pages)
      const debtRows = pages[15]!.split('\n').map(compact).filter(line => line.startsWith('Долговые обязательства '))
      if (debtRows.length !== 2 || debtRows[0] !== 'Долговые обязательства 205,5 179,6' || debtRows[1] !== 'Долговые обязательства 71,8 90,1') {
        throw new Error('Yandex debt components changed')
      }
      // Deterministic decimal arithmetic in tenths of billions: long-term + short-term, excluding leases.
      for (const [index, values] of [[2055, 718], [1796, 901]].entries()) {
        const total = values.reduce((sum, value) => sum + value, 0)
        const date = index === 0 ? '2026-06-30' : '2025-12-31'
        facts.push({
          metricKey: 'debt',
          value: `${Math.trunc(total / 10)}.${total % 10}`,
          unit: 'млрд RUB',
          originalUnit: 'млрд российских рублей',
          locator: 'PDF p.16; долгосрочные + краткосрочные долговые обязательства; без аренды',
          periodStart: date,
          periodEnd: date,
          basis: 'reported',
          periodKind: 'instant',
        })
      }
      // Adjusted EBITDA/net debt are intentionally not relabelled as IFRS debt or earnings.
    } else {
      if (!compact(pages[1] ?? '').includes('USD million') || !compact(pages[0] ?? '').includes('AUDITED CONSOLIDATED IFRS')) {
        throw new Error('Nornickel standard/unit changed')
      }
      const periods = [{
        start: '2025-01-01',
        end: '2025-12-31',
      }, {
        start: '2024-01-01',
        end: '2024-12-31',
      }]
      for (const [metricKey, label, values, basis] of [
        ['revenue', 'Revenue', ['13763', '12535'], 'reported'],
        ['net_profit', 'Net profit', ['2470', '1815'], 'reported'],
      ] as const) {
        // English thousands separators differ from decimal commas.
        const page = pages[1]!.replace(/(?<=\d),(?=\d{3}\b)/g, '')
        const clone = [...pages]
        clone[1] = page
        addFacts(facts, {
          metricKey,
          label,
          values: [...values],
          basis,
          page: 2,
          periods,
          unit: 'млн USD',
        }, clone)
      }
      const clone = [...pages]
      clone[13] = pages[13]!.replace(/(?<=\d),(?=\d{3}\b)/g, '')
      for (const [metricKey, label, values] of [['debt', 'Total debt', ['11244', '10408']], ['cash', 'Cash and cash equivalents', ['2106', '1822']]] as const) {
        addFacts(facts, {
          metricKey,
          label,
          values: [...values],
          page: 14,
          periods: [{
            start: '2025-12-31',
            end: '2025-12-31',
          }, {
            start: '2024-12-31',
            end: '2024-12-31',
          }],
          unit: 'млн USD',
          periodKind: 'instant',
        }, clone)
      }
    }
    const metadata = manualDocumentInput.parse({
      instrumentId,
      issuer: {
        inn: report.inn,
        name: report.name,
      },
      title: report.title,
      sourceUrl: report.sourceUrl,
      reportingStandard: 'IFRS',
      consolidated: true,
      periodStart: id === 'yandex-2q26' ? '2026-01-01' : '2025-01-01',
      periodEnd: id === 'yandex-2q26' ? '2026-06-30' : '2025-12-31',
      publishedAt: report.publishedAt,
      extractedText: pages.map((page, index) => `PAGE ${index + 1}\n${page}`).join('\n').slice(0, 200_000),
      confirmed: true,
      facts,
    })
    return {
      metadata,
      bytes,
      extractorVersion: 'primary-pdf-poppler-rows-v1',
    }
  }
}

/** CBR HTML is also a primary issuer report; this checks published rows/units rather than assuming PDF coverage. */
export function extractCbrIncomeHtml(body: string) {
  const $ = load(body)
  const text = $.root().text()
  if (!text.includes('тыс. рублей') || !text.includes('1481') || !text.includes('Сбербанк')) {
    throw new Error('CBR report identity/unit changed')
  }
  const rows = $('tr').toArray().map(row => $(row).find('td').toArray().map(cell => $(cell).text().trim()))
  const totals = ['Итого по разделу 1', 'Итого по разделу 2'].map((label) => {
    const row = rows.find(row => row.some(cell => cell === label))
    const value = row?.filter(Boolean).at(-1)?.replace(/\s/g, '').replace(',', '.')
    if (!value || !/^\d+(\.\d+)?$/.test(value)) {
      throw new Error('CBR primary total missing')
    }
    return value
  })
  return {
    interestIncome: totals[0]!,
    commissionIncome: totals[1]!,
  }
}

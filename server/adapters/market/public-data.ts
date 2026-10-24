import { createHash } from 'node:crypto'
import { load } from 'cheerio'
import type { ProviderEvent, ProviderReport } from './types'

const ALIASES: Record<string, string> = {
  SBER: 'сбер(?:банк)?(?:а|у|ом|е)?',
  GAZP: 'газпром(?:а|у|ом|е)?',
  LKOH: 'лукойл(?:а|у|ом|е)?',
  ROSN: 'роснефт[ьиью]',
  NVTK: 'новат[эе]к(?:а|у|ом|е)?',
  GMKN: 'норникел[ьяюем]+|норильск[а-я]+ никел[ьяюем]+',
  CHMF: 'северстал[ьиью]',
  PLZL: 'полюс(?:а|у|ом|е)?',
  PHOR: 'фосагро',
  TATN: 'татнефт[ьиью]',
  MTSS: 'мтс',
  MGNT: 'магнит(?:а|у|ом|е)?',
  AFLT: 'аэрофлот(?:а|у|ом|е)?',
  ALRS: 'алрос[аыуе]',
  YDEX: 'яндекс(?:а|у|ом|е)?',
}

export function sourceHash(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}

export function safeSourceUrl(value: string | undefined, base: string) {
  try {
    const url = new URL(value ?? '', base)
    if (!value || !['http:', 'https:'].includes(url.protocol)) {
      return null
    }
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith('utm_') || key === 'news_to_finamb') {
        url.searchParams.delete(key)
      }
    }
    return url.href
  } catch {
    return null
  }
}

function plainText(html: string) {
  const $ = load(html)
  $('script,style,iframe').remove()
  return $.text().replace(/\s+/g, ' ').trim()
}

export function parseFinamNews(xml: string): ProviderEvent[] {
  const $ = load(xml, { xml: true })
  if (!$('rss > channel').length) {
    throw new Error('Finam RSS: expected an RSS channel')
  }
  const events: ProviderEvent[] = []
  $('item').each((_, node) => {
    const item = $(node)
    const title = plainText(item.find('title').text()).slice(0, 500)
    const url = safeSourceUrl(item.find('link').text(), 'https://www.finam.ru')
    const published = new Date(item.find('pubDate').text())
    if (!title || !url || !Number.isFinite(published.getTime())) {
      return
    }
    events.push({
      externalId: `finam-news:${sourceHash(url)}`,
      symbol: null,
      kind: 'news',
      title,
      body: plainText(item.find('description').text()).slice(0, 1600) || title,
      url,
      source: 'Finam.ru · RSS',
      sentiment: null,
      publishedAt: published.toISOString(),
    })
  })
  return events
}

export function newsForSymbol(events: ProviderEvent[], symbol: string, from: Date, to: Date) {
  const ticker = symbol.split('@')[0]!
  if (!/^[A-Z0-9]+$/.test(ticker) || ticker === 'IMOEX') {
    return []
  }
  const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${ticker}|${ALIASES[ticker] ?? ticker})(?!\\p{L}|\\p{N})`, 'iu')
  return events.filter(event => new Date(event.publishedAt) >= from && new Date(event.publishedAt) <= to
    && pattern.test(`${event.title} ${event.body}`)).map(event => ({
    ...event,
    // One article may mention multiple issuers; each gets its own association.
    externalId: `${event.externalId}:${ticker}`,
    symbol,
  }))
}

export function sourceNumber(text: string): number | null {
  const value = text.replace(/[\s\u00a0\u202f]/g, '').replace(/−/g, '-').replace(',', '.').replace(/%$/, '')
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) {
    return null
  }
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

const MONEY_FIELDS: Record<string, string> = {
  revenue: 'revenue',
  net_income: 'netIncome',
  ebitda: 'ebitda',
  operating_income: 'operatingIncome',
  net_operating_income: 'netOperatingIncome',
  net_interest_income: 'netInterestIncome',
  assets: 'assets',
  bank_assets: 'assets',
  net_assets: 'equity',
  capital: 'equity',
  debt: 'debt',
  cash: 'cash',
  net_debt: 'netDebt',
  ocf: 'operatingCashFlow',
  capex: 'capex',
  fcf: 'freeCashFlow',
}

function reportDate(value: string) {
  const match = value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (!match) {
    return null
  }
  const isoDay = `${match[3]}-${match[2]}-${match[1]}`
  const midnight = new Date(`${isoDay}T00:00:00Z`)
  if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== isoDay) {
    return null
  }
  // Source has only a date. End of the Moscow day avoids assuming morning availability.
  const date = new Date(`${match[3]}-${match[2]}-${match[1]}T23:59:59.999+03:00`)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

/** Numeric tables are observed snapshots, not point-in-time historical filings. */
export function parseSmartLabReports(html: string, symbol: string, sourceUrl: string, observedAt: Date): ProviderReport[] {
  const $ = load(html)
  const header = $('tr.header_row').first().children('td').not('.chartrow,.ltm_spc')
  const cells = (field: string) => $(`tr[field="${field}"]`).first().children('td').not('.chartrow,.ltm_spc')
  if (!header.length || !cells('date').length) {
    throw new Error(`Smart-Lab: missing financial table for ${symbol}`)
  }
  const reports: ProviderReport[] = []
  header.each((index, cell) => {
    const period = $(cell).text().trim()
    // LTM mixes periods and valuation fields. Import only explicit fiscal periods.
    if (!/^20\d{2}(?:Q[1-4])?$/.test(period)) {
      return
    }
    const publishedAt = reportDate(cells('date').eq(index).text())
    if (!publishedAt || new Date(publishedAt) > observedAt || cells('currency').eq(index).text().trim() !== 'RUB') {
      return
    }
    const metrics: Record<string, number> = {}
    for (const [field, key] of Object.entries(MONEY_FIELDS)) {
      const row = $(`tr[field="${field}"]`).first()
      const label = row.children('th').first().text().replace(/\s+/g, ' ').trim()
      const amount = sourceNumber(cells(field).eq(index).text())
      // Units must be explicit; never guess or turn missing values into zero.
      const unit = label.match(/(млрд|млн|тыс)\.?\s*руб/iu)?.[1]?.toLowerCase()
      if (amount !== null && unit) {
        const scale = {
          млрд: 1e9,
          млн: 1e6,
          тыс: 1e3,
        }[unit]!
        const value = amount * scale
        if (Number.isFinite(value)) {
          metrics[key] = value
        }
      }
    }
    for (const key of ['roe', 'roa', 'core_capital_adequacy_ratio', 'total_capital_adequacy_ratio', 'share_of_non_performing_loans']) {
      const amount = sourceNumber(cells(key).eq(index).text())
      if (amount !== null && $(`tr[field="${key}"] th`).first().text().includes('%')) {
        metrics[key] = amount / 100
      }
    }
    if (!Object.keys(metrics).length) {
      return
    }
    if (metrics.revenue && metrics.netIncome !== undefined) {
      metrics.netMargin = metrics.netIncome / metrics.revenue
    }
    if (metrics.ebitda && metrics.debt !== undefined) {
      metrics.debtToEbitda = metrics.debt / metrics.ebitda
    }
    const documentUrl = safeSourceUrl(cells('report_url').eq(index).find('a').attr('href'), sourceUrl)
    const hash = sourceHash(JSON.stringify({
      metrics,
      publishedAt,
      documentUrl,
    }))
    reports.push({
      externalId: `smartlab:${symbol}:${period}:${hash}`,
      symbol,
      period,
      reportType: 'IFRS',
      metrics,
      source: 'Smart-Lab · агрегатор МСФО',
      url: sourceUrl,
      documentUrl,
      availableAt: observedAt.toISOString(),
      publishedAt,
    })
  })
  return reports
}

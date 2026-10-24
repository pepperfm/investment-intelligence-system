import type { ProviderEvent, ProviderReport } from './types'
import { newsForSymbol, parseFinamNews, parseSmartLabReports } from './public-data'

interface CachedText {
  expires: number
  value: Promise<{
    body: string
    observedAt: Date
  }>
}

/** Public sources are fetched only from manual data refresh, never by an AI role. */
export class PublicFundamentals {
  private readonly cache = new Map<string, CachedText>()

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private text(url: string) {
    const previous = this.cache.get(url)
    if (previous && previous.expires > Date.now()) {
      return previous.value
    }
    const value = (async () => {
      const response = await this.fetchImpl(url, {
        headers: { 'user-agent': 'IIS personal research/1.0' },
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) {
        throw new Error(`Public source ${new URL(url).hostname}: HTTP ${response.status}`)
      }
      const body = await response.text()
      if (body.length > 2_000_000) {
        throw new Error('Public source response exceeds 2 MB')
      }
      return {
        body,
        observedAt: new Date(),
      }
    })()
    // Cache failures briefly too: one inaccessible feed must not be retried per ticker.
    this.cache.set(url, {
      value,
      expires: Date.now() + 15 * 60_000,
    })
    return value
  }

  async getEvents(symbol: string, from: Date, to: Date): Promise<ProviderEvent[]> {
    if (symbol === 'IMOEX@MISX') {
      return []
    }
    const { body } = await this.text('https://www.finam.ru/analysis/conews/rsspoint/')
    return newsForSymbol(parseFinamNews(body), symbol, from, to)
  }

  async getReports(symbol: string, from: Date, to: Date): Promise<ProviderReport[]> {
    if (symbol === 'IMOEX@MISX') {
      return []
    }
    const ticker = symbol.split('@')[0]!
    if (!/^[A-Z0-9]+$/.test(ticker)) {
      throw new Error('Unsupported financial report ticker')
    }
    const reports: ProviderReport[] = []
    for (const frequency of ['y', 'q']) {
      const url = `https://smart-lab.ru/q/${ticker}/f/${frequency}/MSFO/`
      const { body, observedAt } = await this.text(url)
      reports.push(...parseSmartLabReports(body, symbol, url, observedAt))
    }
    return reports.filter(r => new Date(r.publishedAt) >= from && new Date(r.publishedAt) <= to)
  }
}

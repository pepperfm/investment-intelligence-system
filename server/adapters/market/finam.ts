import type { Candle } from '../../../shared/types/investment'
import type { MarketDataProvider, ProviderAccount, ProviderInstrument } from './types'

const BASE_URL = 'https://api.finam.ru'

interface FinamDecimal {
  value?: string
}

function num(value: FinamDecimal | string | number | undefined | null) {
  if (value === undefined || value === null) {
    return 0
  }
  if (typeof value === 'number') {
    return value
  }
  return Number(typeof value === 'string' ? value : value.value ?? 0)
}

export interface FinamConfig {
  /** Read-only secret. The trade-write secret is deliberately not part of this adapter. */
  secret: string
  accountId: string
  fetchImpl?: typeof fetch
}

/**
 * Finam Trade API v1 (REST), market-data and account read endpoints only.
 * Written from the public docs; not verified against a live account (see IMPLEMENTATION_PLAN).
 */
export class FinamMarketDataProvider implements MarketDataProvider {
  readonly id = 'finam' as const
  readonly benchmarkSymbol = 'IMOEX@MISX'
  private token: string | null = null
  private tokenExpiresAt = 0
  private readonly fetchImpl: typeof fetch

  constructor(private readonly config: FinamConfig) {
    if (!config.secret) {
      throw new Error('NUXT_FINAM_READ_SECRET is not configured')
    }
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  async listInstruments(): Promise<ProviderInstrument[]> {
    const data = await this.get<{
      assets?: {
        symbol: string
        ticker: string
        mic: string
        name: string
        type: string
        isin?: string
      }[]
    }>('/v1/assets')
    return (data.assets ?? [])
      .filter(a => a.mic === 'MISX' && (a.type === 'EQUITIES' || a.type === 'INDICES'))
      .map(a => ({
        symbol: a.symbol,
        ticker: a.ticker,
        board: a.type === 'INDICES' ? 'SNDX' : 'TQBR',
        name: a.name,
        sector: 'other',
        kind: a.type === 'INDICES' ? 'index' as const : 'equity' as const,
        lotSize: 1,
        currency: 'RUB',
        isin: a.isin ?? null,
      }))
  }

  async getLotSize(symbol: string) {
    const params = this.config.accountId ? `?account_id=${encodeURIComponent(this.config.accountId)}` : ''
    const data = await this.get<{ lot_size?: FinamDecimal }>(`/v1/assets/${encodeURIComponent(symbol)}${params}`)
    return Math.max(1, num(data.lot_size))
  }

  async getCandles(symbol: string, from: Date, to: Date): Promise<Candle[]> {
    const result: Candle[] = []
    // Daily bars are requested in yearly windows to respect the API interval limit.
    let start = from
    while (start < to) {
      const end = new Date(Math.min(to.getTime(), start.getTime() + 365 * 86_400_000))
      const query = new URLSearchParams({
        'timeframe': 'TIME_FRAME_D',
        'interval.start_time': start.toISOString(),
        'interval.end_time': end.toISOString(),
      })
      const data = await this.get<{
        bars?: {
          timestamp: string
          open: FinamDecimal
          high: FinamDecimal
          low: FinamDecimal
          close: FinamDecimal
          volume: FinamDecimal
        }[]
      }>(`/v1/instruments/${encodeURIComponent(symbol)}/bars?${query}`)
      for (const bar of data.bars ?? []) {
        const day = new Date(bar.timestamp)
        result.push({
          ts: new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())).toISOString(),
          open: num(bar.open),
          high: num(bar.high),
          low: num(bar.low),
          close: num(bar.close),
          volume: num(bar.volume),
        })
      }
      start = end
    }
    return result
  }

  /** Finam does not provide news/filings via Trade API: a separate source is an open decision. */
  async getEvents() {
    return []
  }

  async getReports() {
    return []
  }

  async getAccount(): Promise<ProviderAccount | null> {
    if (!this.config.accountId) {
      return null
    }
    const data = await this.get<{
      equity?: FinamDecimal
      cash?: {
        currency_code: string
        units?: string
        nanos?: number
      }[]
      positions?: {
        symbol: string
        quantity: FinamDecimal
        average_price: FinamDecimal
        current_price: FinamDecimal
      }[]
    }>(`/v1/accounts/${encodeURIComponent(this.config.accountId)}`)
    const rub = data.cash?.find(c => c.currency_code === 'RUB')
    return {
      externalId: this.config.accountId,
      currency: 'RUB',
      cash: rub ? Number(rub.units ?? 0) + (rub.nanos ?? 0) / 1e9 : 0,
      equity: num(data.equity),
      positions: (data.positions ?? []).map(p => ({
        symbol: p.symbol,
        quantity: num(p.quantity),
        avgPrice: num(p.average_price),
        lastPrice: num(p.current_price),
      })),
    }
  }

  private async authToken() {
    if (this.token && Date.now() < this.tokenExpiresAt) {
      return this.token
    }
    const response = await this.fetchImpl(`${BASE_URL}/v1/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: this.config.secret }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      throw new Error(`Finam auth failed: HTTP ${response.status}`)
    }
    const body = await response.json() as { token?: string }
    if (!body.token) {
      throw new Error('Finam auth failed: no token')
    }
    this.token = body.token
    // JWT lifetime is ~15 minutes; refresh earlier.
    this.tokenExpiresAt = Date.now() + 10 * 60_000
    return this.token
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(`${BASE_URL}${path}`, {
      headers: { Authorization: await this.authToken() },
      signal: AbortSignal.timeout(20_000),
    })
    if (response.status === 401) {
      this.token = null
    }
    if (!response.ok) {
      throw new Error(`Finam ${path.split('?')[0]} failed: HTTP ${response.status}`)
    }
    return await response.json() as T
  }
}

import type { Candle } from '../../../shared/types/investment'
import type { MarketDataProvider, ProviderAccount, ProviderInstrument } from './types'
import { PublicFundamentals } from './public-fundamentals'

const BASE_URL = 'https://api.finam.ru'

interface FinamDecimal {
  value?: string
}

interface FinamAsset {
  symbol?: string
  ticker: string
  mic: string
  name: string
  type: string
  isin?: string
  is_archived?: boolean
  board?: string
  lot_size?: FinamDecimal
  quote_currency?: string
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
  /** Server-only credential. This adapter never calls order-write endpoints. */
  secret: string
  accountId: string
  /** Optional explicit research universe; always includes the benchmark. */
  symbols?: string[]
  fetchImpl?: typeof fetch
}

/**
 * Finam Trade API v1 (REST), market-data and account read endpoints only.
 * Uses only market-data and account read endpoints. Secrets never reach AI processes.
 */
export class FinamMarketDataProvider implements MarketDataProvider {
  readonly id = 'finam' as const
  readonly benchmarkSymbol = 'IMOEX@MISX'
  private token: string | null = null
  private tokenExpiresAt = 0
  private readonly fetchImpl: typeof fetch
  private readonly fundamentals: PublicFundamentals

  constructor(private readonly config: FinamConfig) {
    if (!config.secret) {
      throw new Error('NUXT_FINAM_READ_SECRET is not configured')
    }
    this.fetchImpl = config.fetchImpl ?? fetch
    this.fundamentals = new PublicFundamentals(this.fetchImpl)
  }

  async listInstruments(): Promise<ProviderInstrument[]> {
    let symbols = this.config.symbols?.length ? [...this.config.symbols] : []
    if (!symbols.length) {
      // /v1/assets can exceed the gateway response limit; AllAssets is paginated.
      const seen = new Set<string>()
      let cursor = ''
      do {
        const query = new URLSearchParams({
          only_active: 'true',
          cursor,
        })
        const data = await this.get<{
          assets: FinamAsset[]
          next_cursor?: string
        }>(`/v1/assets/all?${query}`)
        symbols.push(...data.assets.filter(a => a.mic === 'MISX' && a.type === 'EQUITIES' && !a.is_archived).map(a => a.symbol!))
        cursor = data.next_cursor ?? ''
        if (cursor && seen.has(cursor)) {
          throw new Error('Finam asset pagination repeated a cursor')
        }
        seen.add(cursor)
      } while (cursor && cursor !== '0')
    }
    symbols = [...new Set([...symbols, this.benchmarkSymbol])]
    const instruments: ProviderInstrument[] = []
    for (const symbol of symbols) {
      const a = await this.asset(symbol)
      if (a.mic !== 'MISX' || !['EQUITIES', 'INDICES'].includes(a.type) || a.is_archived) {
        throw new Error(`Finam unsupported research instrument: ${symbol}`)
      }
      instruments.push({
        symbol,
        ticker: a.ticker,
        board: a.board || (a.type === 'INDICES' ? 'SNDX' : 'TQBR'),
        name: a.name,
        sector: 'other',
        kind: a.type === 'INDICES' ? 'index' as const : 'equity' as const,
        lotSize: this.lotSize(a),
        currency: a.quote_currency || 'RUB',
        isin: a.isin ?? null,
      })
    }
    return instruments
  }

  async getLotSize(symbol: string) {
    return this.lotSize(await this.asset(symbol))
  }

  private lotSize(asset: FinamAsset) {
    const size = num(asset.lot_size)
    if (!Number.isSafeInteger(size) || size < 1) {
      throw new Error(`Finam invalid lot size for ${asset.ticker}`)
    }
    return size
  }

  private asset(symbol: string) {
    const params = this.config.accountId ? `?account_id=${encodeURIComponent(this.config.accountId)}` : ''
    return this.get<FinamAsset>(`/v1/assets/${encodeURIComponent(symbol)}${params}`)
  }

  async getCandles(symbol: string, from: Date, to: Date): Promise<Candle[]> {
    const result = new Map<string, Candle>()
    // Only completed UTC days; today's changing bar must not enter research/backtests.
    const today = new Date()
    const until = new Date(Math.min(to.getTime(), Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())))
    // Daily bars are requested in yearly windows to respect the API interval limit.
    let start = from
    while (start < until) {
      const end = new Date(Math.min(until.getTime(), start.getTime() + 365 * 86_400_000))
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
        if (!Number.isFinite(day.getTime())) {
          throw new Error(`Finam invalid candle timestamp for ${symbol}`)
        }
        const candle = {
          ts: new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())).toISOString(),
          open: num(bar.open),
          high: num(bar.high),
          low: num(bar.low),
          close: num(bar.close),
          volume: num(bar.volume),
        }
        if (day < start || day >= end) {
          continue
        }
        if (![candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite)
          || Math.min(candle.open, candle.high, candle.low, candle.close) <= 0
          || candle.low > Math.min(candle.open, candle.close)
          || candle.high < Math.max(candle.open, candle.close) || candle.volume < 0) {
          throw new Error(`Finam invalid candle prices for ${symbol}`)
        }
        result.set(candle.ts, candle)
      }
      start = end
    }
    return [...result.values()].sort((a, b) => a.ts.localeCompare(b.ts))
  }

  getEvents(symbol: string, from: Date, to: Date) {
    return this.fundamentals.getEvents(symbol, from, to)
  }

  getReports(symbol: string, from: Date, to: Date) {
    return this.fundamentals.getReports(symbol, from, to)
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

  private async get<T>(path: string, attempt = 0): Promise<T> {
    const response = await this.fetchImpl(`${BASE_URL}${path}`, {
      headers: { Authorization: await this.authToken() },
      signal: AbortSignal.timeout(20_000),
    })
    if (response.status === 401) {
      this.token = null
      if (attempt === 0) {
        return this.get<T>(path, 1)
      }
    }
    if (response.status === 429 && attempt < 2) {
      const seconds = Number(response.headers.get('retry-after')) || 30
      await new Promise(resolve => setTimeout(resolve, Math.min(60, Math.max(1, seconds)) * 1000))
      return this.get<T>(path, attempt + 1)
    }
    if (!response.ok) {
      throw new Error(`Finam ${path.split('?')[0]} failed: HTTP ${response.status}`)
    }
    return await response.json() as T
  }
}

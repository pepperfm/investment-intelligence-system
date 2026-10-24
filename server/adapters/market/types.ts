import type { Candle } from '../../../shared/types/investment'

export interface ProviderInstrument {
  symbol: string
  ticker: string
  board: string
  name: string
  sector: string
  kind: 'equity' | 'index'
  lotSize: number
  currency: string
  isin: string | null
}

export interface ProviderEvent {
  externalId: string
  symbol: string | null
  kind: 'news' | 'corporate' | 'macro' | 'dividend'
  title: string
  body: string
  url: string | null
  source: string
  sentiment: number | null
  publishedAt: string
}

export interface ProviderReport {
  externalId: string
  symbol: string
  period: string
  reportType: 'IFRS' | 'RAS'
  metrics: Record<string, number>
  source: string
  url: string | null
  publishedAt: string
}

export interface ProviderPosition {
  symbol: string
  quantity: number
  avgPrice: number
  lastPrice: number
}

export interface ProviderAccount {
  externalId: string
  currency: string
  cash: number
  equity: number
  positions: ProviderPosition[]
}

/** Read-only market data contract. No method here may create, modify or cancel orders. */
export interface MarketDataProvider {
  readonly id: 'mock' | 'finam'
  readonly benchmarkSymbol: string
  listInstruments(): Promise<ProviderInstrument[]>
  getCandles(symbol: string, from: Date, to: Date): Promise<Candle[]>
  getEvents(symbol: string, from: Date, to: Date): Promise<ProviderEvent[]>
  getReports(symbol: string, from: Date, to: Date): Promise<ProviderReport[]>
  getAccount(): Promise<ProviderAccount | null>
}

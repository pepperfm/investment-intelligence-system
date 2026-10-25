import { describe, expect, it, vi } from 'vitest'
import { FinamMarketDataProvider } from '../server/adapters/market/finam'

const asset = {
  ticker: 'SBER',
  mic: 'MISX',
  name: 'Сбербанк',
  type: 'EQUITIES',
  lot_size: { value: '10' },
  board: 'TQBR',
  quote_currency: 'RUB',
}

describe('Finam read-only market adapter', () => {
  it('paginates the directory, hydrates real lot sizes and includes the benchmark', async () => {
    const requests: string[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      requests.push(url.pathname + url.search)
      let data: unknown = { token: 'test-jwt' }
      if (url.pathname === '/v1/assets/all') {
        data = url.searchParams.get('cursor')
          ? {
              assets: [{
                ...asset,
                symbol: 'SBER@MISX',
              }],
              next_cursor: '',
            }
          : {
              assets: [{
                ...asset,
                mic: 'XNYS',
                symbol: 'X@XNYS',
              }],
              next_cursor: 'next',
            }
      } else if (url.pathname.startsWith('/v1/assets/')) {
        expect(url.searchParams.get('account_id')).toBe('test-account')
        data = url.pathname.includes('IMOEX')
          ? {
              ...asset,
              ticker: 'IMOEX',
              type: 'INDICES',
              lot_size: { value: '1' },
            }
          : asset
      }
      return Response.json(data)
    }) as typeof fetch
    const provider = new FinamMarketDataProvider({
      secret: 'test',
      accountId: 'test-account',
      fetchImpl,
    })
    const result = await provider.listInstruments()
    expect(result.map(i => i.symbol)).toEqual(['SBER@MISX', 'IMOEX@MISX'])
    expect(result[0]?.lotSize).toBe(10)
    expect(requests.some(r => r.includes('cursor=next'))).toBe(true)
    expect(requests).not.toContain('/v1/assets')
  })
  it('refreshes an expired JWT once, preserves duplicate bars for quarantine and rejects corrupt prices', async () => {
    let auth = 0
    let calls = 0
    let corrupt = false
    const bar = {
      timestamp: '2024-01-02T04:00:00Z',
      open: { value: '100' },
      high: { value: '105' },
      low: { value: '95' },
      close: { value: '102' },
      volume: { value: '1E6' },
    }
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/v1/sessions') {
        auth++
        return Response.json({ token: `test-${auth}` })
      }
      expect(init?.method).toBeUndefined()
      if (calls++ === 0) {
        return new Response(null, { status: 401 })
      }
      return Response.json({
        bars: [bar, {
          ...bar,
          close: { value: corrupt ? 'NaN' : '102' },
        }],
      })
    }) as typeof fetch
    const provider = new FinamMarketDataProvider({
      secret: 'test',
      accountId: '',
      fetchImpl,
    })
    const result = await provider.getCandles('SBER@MISX', new Date('2024-01-01'), new Date('2024-01-03'))
    expect(auth).toBe(2)
    expect(result).toHaveLength(2)
    expect(result[0]?.volume).toBe(1_000_000)
    corrupt = true
    await expect(provider.getCandles('SBER@MISX', new Date('2024-01-01'), new Date('2024-01-03'))).rejects.toThrow('invalid candle prices')
  })
})

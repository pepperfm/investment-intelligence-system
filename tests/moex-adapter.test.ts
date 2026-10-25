import { describe, expect, it, vi } from 'vitest'
import { MoexIssResearchProvider } from '../server/adapters/market/moex-iss'

const instrument = {
  ticker: 'ROSN',
  kind: 'equity',
  currency: 'RUB',
}
const columns = ['begin', 'end', 'open', 'high', 'low', 'close', 'volume']
const rows = [['2024-01-03 00:00:00', '2024-01-03 23:59:59', 100, 105, 99, 102, 20]]
describe('MOEX read-only research transport', () => {
  it('keeps repeated daily rows and quarantines them instead of deduplication', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const query = new URL(String(url)).searchParams
      return Response.json({
        candles: {
          columns,
          data: query.get('start') === '0' ? query.get('interval') === '24' ? [rows[0], rows[0]] : rows : [],
        },
      })
    }) as typeof fetch
    const observations: unknown[] = []
    const result = await new MoexIssResearchProvider(fetchImpl).getSeries(instrument, '2024-01-03', '2024-01-03', async (r) => {
      observations.push(r)
    })
    expect(result.assessments[0]?.issues).toContain('duplicate_daily_period')
    expect(observations).toHaveLength(4)
    expect(result.responses[0]?.data).toHaveLength(2)
  })
  it('retains already observed pages if a later request fails; never falls back', async () => {
    let n = 0
    const observed: unknown[] = []
    const fetchImpl = vi.fn(async () => ++n === 1
      ? Response.json({
          candles: {
            columns,
            data: rows,
          },
        })
      : new Response(null, { status: 429 })) as typeof fetch
    await expect(new MoexIssResearchProvider(fetchImpl).getSeries(instrument, '2024-01-03', '2024-01-03', async (r) => {
      observed.push(r)
    })).rejects.toThrow('HTTP 429')
    expect(observed).toHaveLength(1)
    expect(n).toBe(2)
  })
  it('uses index/SNDX and refuses unsupported currency and malformed columns', async () => {
    const urls: string[] = []
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      urls.push(String(url))
      return Response.json({
        candles: {
          columns,
          data: [],
        },
      })
    }) as typeof fetch
    await new MoexIssResearchProvider(fetchImpl).getSeries({
      ...instrument,
      ticker: 'IMOEX',
      kind: 'index',
    }, '2024-01-03', '2024-01-03')
    expect(urls.every(url => url.includes('/markets/index/boards/SNDX/'))).toBe(true)
    await expect(new MoexIssResearchProvider(fetchImpl).getSeries({
      ...instrument,
      currency: 'USD',
    }, '2024-01-03', '2024-01-03')).rejects.toThrow('unsupported')
    await expect(new MoexIssResearchProvider(vi.fn(async () => Response.json({
      candles: {
        columns: ['close'],
        data: [[100]],
      },
    })) as typeof fetch).getSeries(instrument, '2024-01-03', '2024-01-03')).rejects.toThrow('missing OHLCV')
  })
})

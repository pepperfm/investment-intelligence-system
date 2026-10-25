import { marketHash, reconcilePhysicalBars, type IssBar } from '../../domain/market/source-policy'

export interface IssResponse {
  endpoint: string
  observedAt: string
  hash: string
  interval: number
  columns: string[]
  data: unknown[][]
}
export class MoexIssResearchProvider {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}
  async getSeries(instrument: {
    ticker: string
    kind: string
    currency: string
  }, from: string, to: string, observe?: (response: IssResponse) => Promise<void>) {
    if (!['equity', 'index'].includes(instrument.kind) || instrument.currency !== 'RUB') {
      throw new Error('MOEX research: unsupported instrument/currency')
    }
    const market = instrument.kind === 'index' ? 'index' : 'shares'
    const board = instrument.kind === 'index' ? 'SNDX' : 'TQBR'
    const root = `https://iss.moex.com/iss/engines/stock/markets/${market}/boards/${board}/securities/${encodeURIComponent(instrument.ticker)}/candles.json`
    const responses: IssResponse[] = []
    const read = async (interval: number): Promise<IssBar[]> => {
      const all: IssBar[] = []
      let previousHash = ''
      for (let start = 0; start < 100_000;) {
        const endpoint = `${root}?from=${from}&till=${to}&interval=${interval}&start=${start}&iss.meta=off`
        const response = await this.fetchImpl(endpoint, { signal: AbortSignal.timeout(30_000) })
        if (!response.ok) {
          throw new Error(`MOEX ${instrument.ticker}/${board}/${interval}: HTTP ${response.status}`)
        }
        const payload = await response.json() as {
          candles?: {
            columns: string[]
            data: unknown[][]
          }
        }
        const table = payload.candles
        if (!table || !Array.isArray(table.columns) || !Array.isArray(table.data)) {
          throw new Error('MOEX: invalid/partial candles table')
        }
        const required = ['begin', 'end', 'open', 'high', 'low', 'close', 'volume'] as const
        const hash = marketHash(table)
        const observation = {
          endpoint,
          observedAt: new Date().toISOString(),
          hash,
          interval,
          ...table,
        }
        responses.push(observation)
        await observe?.(observation)
        if (required.some(key => !table.columns.includes(key))) {
          throw new Error('MOEX: missing OHLCV columns')
        }
        if (!table.data.length) {
          return all
        }
        if (hash === previousHash) {
          throw new Error('MOEX: repeated pagination page')
        }
        previousHash = hash
        for (const row of table.data) {
          const bar = Object.fromEntries(required.map(key => [key, row[table.columns.indexOf(key)]])) as unknown as IssBar
          if (typeof bar.begin !== 'string' || bar.begin.slice(0, 10) < from || bar.begin.slice(0, 10) > to) {
            throw new Error('MOEX: out-of-range response')
          }
          all.push(bar)
        }
        start += table.data.length
      }
      throw new Error('MOEX: pagination limit, response incomplete')
    }
    // Read complete pages independently. One failed response aborts the audit; no fallback.
    const daily = await read(24)
    const hourly = await read(60)
    const observedAt = new Date().toISOString()
    const sourceRevision = marketHash(responses.map(r => r.hash))
    const assessments = reconcilePhysicalBars(daily, hourly, {
      board,
      market,
      kind: instrument.kind,
      observedAt,
      responseHash: sourceRevision,
      endpoint: root,
      complete: true,
    })
    return {
      board,
      market,
      from,
      to,
      observedAt,
      sourceRevision,
      responses,
      assessments,
    }
  }
}

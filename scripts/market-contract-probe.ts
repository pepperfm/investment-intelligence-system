import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/** Explicit public-market read probe; no DB bootstrap, orders, private account calls or AI. */
if (!process.argv.includes('--live')) {
  console.log('Usage: bun scripts/market-contract-probe.ts --live [--record]')
  process.exit(0)
}
const instruments = ['ROSN', 'NVTK', 'TATN', 'SBER', 'GAZP', 'IMOEX'].map(symbol => ({
  symbol,
  market: symbol === 'IMOEX' ? 'index' : 'shares',
  board: symbol === 'IMOEX' ? 'SNDX' : 'TQBR',
}))
const ranges = process.argv.includes('--conflicts')
  ? [
      {
        id: 'rosn-conflict2025',
        from: '2025-04-10',
        till: '2025-04-10',
      },
      {
        id: 'index-conflict2026',
        from: '2026-10-12',
        till: '2026-10-12',
      },
    ]
  : [
      {
        id: 'september2026',
        from: '2026-09-18',
        till: '2026-09-29',
      },
      {
        id: 'ordinary2024',
        from: '2024-09-23',
        till: '2024-09-27',
      },
      {
        id: 'weekend-launch2025',
        from: '2025-02-28',
        till: '2025-03-10',
      },
      {
        id: 'holidays2026',
        from: '2026-01-01',
        till: '2026-01-09',
      },
    ]
interface Table {
  columns: string[]
  data: unknown[][]
}
interface Response {
  observedAt: string
  endpoint: string
  status: number | null
  sourceResponseHash: string | null
  table: Table | null
  pages: number
}
async function request(endpoint: string, key: string): Promise<Response> {
  const data: unknown[][] = []
  let columns: string[] = []
  let pages = 0
  const hashes: string[] = []
  const observedAt = new Date().toISOString()
  for (let start = 0; start < 100_000; start += 500) {
    const url = `${endpoint}&start=${start}`
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      const raw = await response.text()
      if (!response.ok) {
        return {
          observedAt,
          endpoint,
          status: response.status,
          sourceResponseHash: null,
          table: null,
          pages,
        }
      }
      hashes.push(createHash('sha256').update(raw).digest('hex'))
      const body = JSON.parse(raw) as Record<string, Table>
      const table = body[key]
      if (!table) {
        return {
          observedAt,
          endpoint,
          status: response.status,
          sourceResponseHash: hashes[0]!,
          table: null,
          pages,
        }
      }
      columns = table.columns
      data.push(...table.data)
      pages++
      const cursor = body[`${key}.cursor`]
      if (cursor?.data[0]) {
        const total = Number(cursor.data[0][cursor.columns.indexOf('TOTAL')])
        const pageSize = Number(cursor.data[0][cursor.columns.indexOf('PAGESIZE')])
        if (start + table.data.length >= total || !table.data.length) {
          break
        }
        // History uses100 rows, candles500. Advance by actual returned page size.
        start += pageSize - 500
      } else if (table.data.length < 500) {
        break
      }
    } catch {
      return {
        observedAt,
        endpoint,
        status: null,
        sourceResponseHash: null,
        table: null,
        pages,
      }
    }
  }
  return {
    observedAt,
    endpoint,
    status: 200,
    sourceResponseHash: createHash('sha256').update(hashes.join('\n')).digest('hex'),
    table: {
      columns,
      data,
    },
    pages,
  }
}
function value(table: Table, row: unknown[], key: string) {
  return row[table.columns.indexOf(key)]
}
function aggregate(table: Table, rows: unknown[][]) {
  return {
    open: Number(value(table, rows[0]!, 'open')),
    high: Math.max(...rows.map(r => Number(value(table, r, 'high')))),
    low: Math.min(...rows.map(r => Number(value(table, r, 'low')))),
    close: Number(value(table, rows.at(-1)!, 'close')),
    volume: rows.reduce((sum, r) => sum + Number(value(table, r, 'volume')), 0),
    value: rows.reduce((sum, r) => sum + Number(value(table, r, 'value')), 0),
  }
}
function compare(daily: Response, intraday: Response, isIndex: boolean) {
  if (!daily.table || !intraday.table) {
    return []
  }
  const d = daily.table
  const h = intraday.table
  return d.data.map((row) => {
    const date = String(value(d, row, 'begin')).slice(0, 10)
    const hours = h.data.filter(r => String(value(h, r, 'begin')).startsWith(date))
    const matching = hours.length > 0 ? aggregate(h, hours) : null
    const actual = Object.fromEntries(['open', 'high', 'low', 'close', 'volume', 'value'].map(k => [k, Number(value(d, row, k))]))
    const mismatches = matching ? Object.keys(actual).filter(k => Math.abs(actual[k]! - matching[k as keyof typeof matching]) > Math.max(1e-7, Math.abs(actual[k]!) * 1e-12)) : ['missing_intraday']
    const blockingMismatches = isIndex ? mismatches.filter(k => k !== 'value') : mismatches
    let overlaps = false
    let previousEnd = ''
    for (const hour of hours) {
      const begin = String(value(h, hour, 'begin'))
      const end = String(value(h, hour, 'end'))
      if ((previousEnd && begin <= previousEnd) || !end.startsWith(date) || end < begin) {
        overlaps = true
      }
      previousEnd = end
    }
    return {
      physicalSessionDate: date,
      source: 'moex_iss',
      conclusion: overlaps ? 'overlapping' : blockingMismatches.length ? 'unknown' : 'non_overlapping',
      comparisonScope: isIndex ? 'index_ohlc_volume_zero_not_traded_turnover' : 'equity_ohlcv_and_turnover',
      intradayRows: hours.length,
      firstPeriodBegin: hours.length ? value(h, hours[0]!, 'begin') : null,
      lastPeriodEnd: hours.length ? value(h, hours.at(-1)!, 'end') : null,
      actual,
      aggregate: matching,
      mismatches,
      historicalAvailability: 'unknown',
      adjustmentPolicy: 'source_native_no_retro_adjustment_applied',
      unknowns: ['Historical first publication time is not supplied by these endpoints.', 'Hourly reconciliation establishes non-overlap for this observed series, not immutable future provider behavior.'],
    }
  })
}

function reconcileLogicalHistory(daily: Response, history: Response) {
  if (!daily.table || !history.table) {
    return []
  }
  const d = daily.table
  const h = history.table
  let previousDate = ''
  return h.data.map((row) => {
    const date = String(value(h, row, 'TRADEDATE'))
    const physical = d.data.filter((r) => {
      const physicalDate = String(value(d, r, 'begin')).slice(0, 10)
      return physicalDate <= date && (!previousDate || physicalDate > previousDate)
    })
    const boundedByPriorHistory = previousDate !== ''
    previousDate = date
    const grouped = physical.length ? aggregate(d, physical) : null
    const actual = Object.fromEntries(['open', 'high', 'low', 'close', 'volume', 'value'].map(k => [k, value(h, row, k.toUpperCase())]))
    const mismatches = grouped ? Object.keys(actual).filter(k => actual[k] !== null && actual[k] !== undefined && Math.abs(Number(actual[k]) - grouped[k as keyof typeof grouped]) > Math.max(1e-7, Math.abs(Number(actual[k])) * 1e-12)) : ['missing_physical']
    return {
      logicalTradingDate: date,
      physicalSessionDates: physical.map(r => String(value(d, r, 'begin')).slice(0, 10)),
      boundedByPriorHistory,
      actual,
      aggregate: grouped,
      mismatches,
      conclusion: !boundedByPriorHistory ? 'unknown_boundary' : mismatches.length ? 'different_scope_or_unknown' : 'matches_physical_group',
    }
  })
}

const results = []
for (const instrument of instruments.filter(i => !process.argv.includes('--conflicts') || ['ROSN', 'IMOEX'].includes(i.symbol))) {
  for (const range of ranges) {
    const path = `engines/stock/markets/${instrument.market}/boards/${instrument.board}/securities/${instrument.symbol}`
    const query = `from=${range.from}&till=${range.till}&iss.meta=off`
    const [daily, intraday, history] = await Promise.all([
      request(`https://iss.moex.com/iss/${path}/candles.json?${query}&interval=24`, 'candles'),
      request(`https://iss.moex.com/iss/${path}/candles.json?${query}&interval=60`, 'candles'),
      request(`https://iss.moex.com/iss/history/${path}.json?${query}`, 'history'),
    ])
    const comparisons = compare(daily, intraday, instrument.market === 'index')
    results.push({
      instrument,
      range,
      fieldMapping: {
        daily: 'open/high/low/close/volume/value/begin/end',
        intraday: 'same fields; ordered disjoint hourly periods',
        history: 'TRADEDATE/TRADINGSESSION/OPEN/HIGH/LOW/CLOSE/VOLUME/VALUE where present',
      },
      daily,
      intraday,
      history,
      comparisons,
      logicalHistoryComparison: reconcileLogicalHistory(daily, history),
    })
    console.log(JSON.stringify({
      symbol: instrument.symbol,
      range: range.id,
      daily: daily.table?.data.length ?? 0,
      hourly: intraday.table?.data.length ?? 0,
      history: history.table?.data.length ?? 0,
      nonOverlapping: comparisons.filter(c => c.conclusion === 'non_overlapping').length,
      problems: comparisons.filter(c => c.conclusion !== 'non_overlapping').map(c => ({
        date: c.physicalSessionDate,
        mismatches: c.mismatches,
      })),
    }))
  }
}
if (process.argv.includes('--record')) {
  const dir = resolve(import.meta.dir, '../tests/fixtures/calendar')
  await mkdir(dir, { recursive: true })
  await writeFile(resolve(dir, process.argv.includes('--conflicts') ? 'moex-conflicts.json' : 'moex-reconciliation.json'), `${JSON.stringify({
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    policyCandidate: 'physical_session_v1',
    results,
  }, null, 2)}\n`)
}

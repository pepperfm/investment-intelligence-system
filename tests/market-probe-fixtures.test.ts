import { describe, expect, it } from 'vitest'
import reconciliation from './fixtures/calendar/moex-reconciliation.json'
import finamProbe from './fixtures/calendar/daily-feed-probe-v2.json'
import conflicts from './fixtures/calendar/moex-conflicts.json'
import { reconcilePhysicalBars, type IssBar } from '../server/domain/market/source-policy'

interface Table {
  columns: string[]
  data: unknown[][]
}
function field(table: Table, row: unknown[], key: string) {
  return row[table.columns.indexOf(key)]
}
function asBars(table: Table): IssBar[] {
  return table.data.map(row => Object.fromEntries(['open', 'high', 'low', 'close', 'volume', 'begin', 'end'].map(key => [key, field(table, row, key)])) as unknown as IssBar)
}

describe('real public MOEX/Finam contract fixtures', () => {
  it('quarantines real daily/intraday conflicts rather than declaring every observed period usable', () => {
    for (const [symbol, rangeId] of [['ROSN', 'rosn-conflict2025'], ['IMOEX', 'index-conflict2026']]) {
      const result = conflicts.results.find(r => r.instrument.symbol === symbol && r.range.id === rangeId)!
      const actual = reconcilePhysicalBars(asBars(result.daily.table!), asBars(result.intraday.table!), {
        board: result.instrument.board,
        market: result.instrument.market,
        kind: symbol === 'IMOEX' ? 'index' : 'equity',
        observedAt: conflicts.capturedAt,
        responseHash: result.daily.sourceResponseHash!,
        endpoint: result.daily.endpoint,
        complete: true,
      })
      expect(actual[0]?.status).toBe('quarantined')
      expect(actual[0]?.issues.some(issue => issue.startsWith('daily_intraday_mismatch:'))).toBe(true)
    }
  })
  it('reconciles all recorded physical price periods independently against hourly OHLCV', () => {
    expect(reconciliation.results).toHaveLength(24)
    let periods = 0
    for (const result of reconciliation.results) {
      expect(result.instrument.board).toBe(result.instrument.symbol === 'IMOEX' ? 'SNDX' : 'TQBR')
      const daily = result.daily.table!
      const hourly = result.intraday.table!
      expect(result.daily.status).toBe(200)
      expect(result.intraday.status).toBe(200)
      expect(result.daily.sourceResponseHash).toMatch(/^[a-f0-9]{64}$/)
      for (const day of daily.data) {
        const date = String(field(daily, day, 'begin')).slice(0, 10)
        const hours = hourly.data.filter(row => String(field(hourly, row, 'begin')).startsWith(date))
        expect(hours.length).toBeGreaterThan(0)
        let previousEnd = ''
        for (const hour of hours) {
          const start = String(field(hourly, hour, 'begin'))
          const end = String(field(hourly, hour, 'end'))
          expect(end.slice(0, 10)).toBe(date)
          expect(start > previousEnd).toBe(true)
          previousEnd = end
        }
        expect(field(daily, day, 'open')).toBe(field(hourly, hours[0]!, 'open'))
        expect(field(daily, day, 'close')).toBe(field(hourly, hours.at(-1)!, 'close'))
        expect(field(daily, day, 'high')).toBe(Math.max(...hours.map(row => Number(field(hourly, row, 'high')))))
        expect(field(daily, day, 'low')).toBe(Math.min(...hours.map(row => Number(field(hourly, row, 'low')))))
        expect(field(daily, day, 'volume')).toBe(hours.reduce((n, row) => n + Number(field(hourly, row, 'volume')), 0))
        periods++
      }
    }
    expect(periods).toBe(176)
  })

  it('proves ROSN history Monday includes the weekend while physical Monday does not', () => {
    const result = reconciliation.results.find(r => r.instrument.symbol === 'ROSN' && r.range.id === 'september2026')!
    const daily = result.daily.table!
    const history = result.history.table!
    const monday = history.data.find(row => field(history, row, 'TRADEDATE') === '2026-09-28')!
    const days = daily.data.filter(row => ['2026-09-26', '2026-09-27', '2026-09-28'].includes(String(field(daily, row, 'begin')).slice(0, 10)))
    expect(days).toHaveLength(3)
    expect(days.map(row => field(daily, row, 'volume'))).toEqual([801050, 418234, 11572990])
    expect(field(history, monday, 'VOLUME')).toBe(days.reduce((n, row) => n + Number(field(daily, row, 'volume')), 0))
    expect(field(history, monday, 'OPEN')).toBe(field(daily, days[0]!, 'open'))
    expect(field(history, monday, 'CLOSE')).toBe(field(daily, days[2]!, 'close'))
    expect(field(history, monday, 'HIGH')).toBe(Math.max(...days.map(row => Number(field(daily, row, 'high')))))
    expect(field(history, monday, 'LOW')).toBe(Math.min(...days.map(row => Number(field(daily, row, 'low')))))
  })

  it('does not call index turnover independently verified when only index prices agree', () => {
    const result = reconciliation.results.find(r => r.instrument.symbol === 'IMOEX' && r.range.id === 'september2026')!
    const warnings = result.comparisons.filter(c => c.mismatches.includes('value'))
    expect(warnings).toHaveLength(6)
    expect(warnings.every(c => c.comparisonScope === 'index_ohlc_volume_zero_not_traded_turnover')).toBe(true)
    expect(result.comparisons.every(c => c.actual.volume === 0)).toBe(true)
    expect(result.comparisons.some(c => c.physicalSessionDate === '2026-09-19')).toBe(false)
  })

  it('feeds the real reconciled slices through the policy and quarantines duplicated evidence', () => {
    const slice = reconciliation.results.find(r => r.instrument.symbol === 'ROSN' && r.range.id === 'ordinary2024')!
    const daily = asBars(slice.daily.table!)
    const hourly = asBars(slice.intraday.table!)
    const context = {
      board: 'TQBR',
      market: 'shares',
      kind: 'equity',
      observedAt: reconciliation.capturedAt,
      responseHash: slice.daily.sourceResponseHash!,
      endpoint: slice.daily.endpoint,
      complete: true,
    }
    const assessments = reconcilePhysicalBars(daily, hourly, context)
    expect(assessments).toHaveLength(5)
    expect(assessments.every(a => a.status === 'research_usable_with_limits')).toBe(true)
    expect(assessments.every(a => a.candle?.historicalAvailability === 'unknown' && a.candle.reconstruction)).toBe(true)
    expect(reconcilePhysicalBars(daily, [hourly[0]!, ...hourly], context)[0]?.status).toBe('quarantined')
  })

  it('retains the six-symbol Finam read comparison without authorizing Finam normalization', () => {
    expect(finamProbe.results).toHaveLength(6)
    expect(finamProbe.verdict).toBe('data_quality_blocked')
    for (const result of finamProbe.results) {
      expect(result.finam.status).toBe(200)
      expect(result.finam.sourceResponseHash).toMatch(/^[a-f0-9]{64}$/)
      expect(result.finam.bars.some(b => Date.parse(String(b.timestamp)) >= Date.parse(finamProbe.interval.end))).toBe(true)
    }
  })
})

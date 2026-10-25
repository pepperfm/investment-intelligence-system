import { describe, expect, it } from 'vitest'
import type { Candle } from '../shared/types/investment'
import { addTradingDays, calendarVersion, inspectSession, isTradingDay, moscowDate, staleDays, tradingDaysBetween } from '../server/domain/market/calendar'
import { inspectBarQuality, type VerifiedDailyBarContract } from '../server/domain/market/bar-quality'
import probe from './fixtures/calendar/daily-feed-probe.json'

const date = (s: string) => new Date(`${s}T12:00:00Z`)
const bar = (s: string): Candle => ({
  ts: `${s}T00:00:00Z`,
  open: 100,
  high: 110,
  low: 90,
  close: 105,
  volume: 1000,
})

describe('verified MOEX calendar', () => {
  it('separates the physical weekend from its next logical trading day', () => {
    for (const day of ['2026-09-26', '2026-09-27']) {
      const session = inspectSession(date(day), {
        board: 'TQBR',
        symbol: 'ROSN',
        weekendEligible: true,
      })
      expect(session).toMatchObject({
        status: 'open',
        sessionType: 'weekend_additional',
        sessionDate: day,
        tradingDate: '2026-09-28',
      })
      expect(session.opensAt).toBe(`${day}T09:50:00+03:00`)
      expect(isTradingDay(date(day))).toBe(false)
    }
    expect(addTradingDays(date('2026-09-25'), 1).toISOString().slice(0, 10)).toBe('2026-09-28')
    expect(tradingDaysBetween(date('2026-09-25'), date('2026-09-29')).map(d => d.toISOString().slice(0, 10))).toEqual(['2026-09-25', '2026-09-28', '2026-09-29'])
  })
  it('does not infer historical weekend admission from an instrument name', () => {
    expect(inspectSession(date('2026-09-26'), { symbol: 'ROSN' }).status).toBe('unknown')
    expect(inspectSession(date('2026-09-26'), { weekendEligible: false }).status).toBe('closed')
  })
  it('models published October closures, holidays and additional holiday sessions', () => {
    for (const day of ['2026-10-24', '2026-10-25', '2026-01-01', '2026-01-07', '2026-12-31']) {
      expect(inspectSession(date(day), { weekendEligible: true }).status).toBe('closed')
    }
    expect(inspectSession(date('2026-02-23'), { weekendEligible: true })).toMatchObject({
      status: 'open',
      sessionType: 'weekend_additional',
      tradingDate: '2026-02-24',
    })
    expect(isTradingDay(date('2026-03-09'))).toBe(true)
    expect(isTradingDay(date('2026-05-11'))).toBe(true)
    expect(addTradingDays(date('2026-02-20'), 1).toISOString().slice(0, 10)).toBe('2026-02-24')
  })
  it('keeps the publication cutoff for amended November/December weekends', () => {
    const before = {
      weekendEligible: true,
      asOf: date('2026-09-03'),
    }
    const after = {
      weekendEligible: true,
      asOf: date('2026-09-05'),
    }
    expect(inspectSession(date('2026-11-28'), before).status).toBe('open')
    expect(inspectSession(date('2026-11-28'), after).status).toBe('closed')
    expect(inspectSession(date('2026-12-05'), before).status).toBe('closed')
    expect(inspectSession(date('2026-12-05'), after).status).toBe('open')
    expect(calendarVersion(before)).not.toBe(calendarVersion(after))
  })
  it('rejects unverified years and boards; synthetic history is explicitly separate', () => {
    expect(inspectSession(date('2025-09-26')).status).toBe('unknown')
    expect(inspectSession(date('2026-09-26'), { board: 'UNKNOWN' }).status).toBe('unknown')
    expect(() => addTradingDays(date('2025-09-26'), 1)).toThrow('data_quality_blocked')
    expect(addTradingDays(date('2025-09-26'), 1, { provider: 'mock' }).toISOString().slice(0, 10)).toBe('2025-09-29')
    expect(staleDays('2025-09-26', date('2025-09-29'))).toBe(Infinity)
  })
  it('counts one logical day across additional sessions and respects Moscow physical midnight', () => {
    expect(staleDays('2026-09-25', date('2026-09-28'))).toBe(1)
    expect(staleDays('2026-09-25', date('2026-09-27'))).toBe(0)
    expect(moscowDate(new Date('2026-09-25T21:30:00Z'))).toBe('2026-09-26')
    expect(addTradingDays(date('2026-09-25'), 10).toISOString().slice(0, 10)).toBe('2026-10-09')
  })
})

describe('daily bar contract gate', () => {
  it('keeps the real cross-provider weekend reconciliation reproducible without declaring the feed verified', () => {
    expect(probe.verdict).toBe('data_quality_blocked')
    for (const result of probe.results) {
      expect(result.finam.status).toBe(200)
      expect(result.moex.status).toBe(200)
      const moex = result.moex.candles!
      for (const date of ['2026-09-19', '2026-09-20', '2026-09-26', '2026-09-27']) {
        const finam = result.finam.bars.find(b => b.timestamp.startsWith(date))!
        const row = moex.data.find(r => String(r[moex.columns.indexOf('begin')]).startsWith(date))!
        for (const key of ['open', 'high', 'low', 'close', 'volume'] as const) {
          expect(Number(finam[key].value)).toBe(row[moex.columns.indexOf(key)])
        }
      }
      // The returned extra bar is retained as raw evidence, not silently trusted.
      expect(result.finam.bars.some(b => Date.parse(b.timestamp) >= Date.parse(probe.interval.end))).toBe(true)
      expect(result.currentAdmission.historicalAdmissionVerified).toBe(false)
    }
  })
  const contract: VerifiedDailyBarContract = {
    verified: true,
    model: 'trading_day',
    timestampMeaning: 'trading_date',
    version: 'test-only-verified-contract',
    adjustmentPolicy: 'test unadjusted',
    evidenceUrls: ['https://example.test/contract'],
    completedAtByTradingDate: {
      '2026-09-25': '2026-09-25T20:50:00Z',
      '2026-09-28': '2026-09-28T20:50:00Z',
    },
    availableAtByTradingDate: {
      '2026-09-25': '2026-09-25T20:51:00Z',
      '2026-09-28': '2026-09-28T20:51:00Z',
    },
  }
  it('blocks ambiguous Finam bars even on a weekday and never deletes weekend evidence to pass', () => {
    const result = inspectBarQuality([bar('2026-09-25'), bar('2026-09-26')], {
      dataSource: 'finam',
      asOf: date('2026-09-29'),
    })
    expect(result.status).toBe('data_quality_blocked')
    expect(result.issues.some(s => s.includes('contract_unverified'))).toBe(true)
    expect(result.completedBars).toEqual([])
  })
  it('excludes a future completed aggregate despite an already started weekend session', () => {
    const result = inspectBarQuality([bar('2026-09-25'), bar('2026-09-28')], {
      dataSource: 'finam',
      asOf: new Date('2026-09-25T20:59:59Z'),
      contract,
    })
    expect(result.status).toBe('verified')
    expect(result.completedBars.map(b => b.ts.slice(0, 10))).toEqual(['2026-09-25'])
  })
  it('blocks duplicate logical periods, unknown availability and invalid prices', () => {
    expect(inspectBarQuality([bar('2026-09-25'), bar('2026-09-25')], {
      dataSource: 'finam',
      asOf: date('2026-09-29'),
      contract,
    }).status).toBe('data_quality_blocked')
    expect(inspectBarQuality([bar('2026-09-24')], {
      dataSource: 'finam',
      asOf: date('2026-09-29'),
      contract,
    }).status).toBe('data_quality_blocked')
    expect(inspectBarQuality([{
      ...bar('2026-09-25'),
      low: 106,
    }], {
      dataSource: 'finam',
      asOf: date('2026-09-29'),
      contract,
    }).status).toBe('data_quality_blocked')
  })
  it('keeps completed synthetic mock series available without asserting a Finam contract', () => {
    expect(inspectBarQuality([bar('2024-01-02')], {
      dataSource: 'mock',
      asOf: date('2024-01-03'),
    })).toMatchObject({
      status: 'verified',
      calendarVersion: 'mock-weekday-v1',
    })
  })
})

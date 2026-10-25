import { describe, expect, it } from 'vitest'
import { reconcilePhysicalBars } from '../server/domain/market/source-policy'

const daily = {
  begin: '2026-09-28 00:00:00',
  end: '2026-09-28 23:59:59',
  open: 100,
  high: 110,
  low: 99,
  close: 105,
  volume: 30,
}
const hours = [
  {
    ...daily,
    begin: '2026-09-28 06:00:00',
    end: '2026-09-28 06:59:59',
    high: 108,
    close: 107,
    volume: 10,
  },
  {
    ...daily,
    begin: '2026-09-28 07:00:00',
    end: '2026-09-28 07:59:59',
    open: 107,
    low: 101,
    volume: 20,
  },
]
const context = {
  board: 'TQBR',
  market: 'shares',
  kind: 'equity',
  observedAt: '2026-10-01T12:00:00Z',
  responseHash: 'abc',
  endpoint: 'https://iss.moex.com/',
  complete: true,
}
describe('source-policy physical reconciliation', () => {
  it('requires all OHLCV, not matching Close; never accepts a duplicate', () => {
    expect(reconcilePhysicalBars([daily], hours, context)[0]?.status).toBe('research_usable_with_limits')
    expect(reconcilePhysicalBars([{
      ...daily,
      volume: 31,
    }], hours, context)[0]?.status).toBe('quarantined')
    expect(reconcilePhysicalBars([daily, daily], hours, context).every(x => x.status === 'quarantined')).toBe(true)
  })
  it('does not call a partial response, wrong board or unfinished day verified', () => {
    expect(reconcilePhysicalBars([daily], hours, {
      ...context,
      complete: false,
    })[0]?.status).toBe('quarantined')
    expect(reconcilePhysicalBars([daily], hours, {
      ...context,
      board: 'SNDX',
    })[0]?.status).toBe('quarantined')
    expect(reconcilePhysicalBars([daily], hours, {
      ...context,
      observedAt: '2026-09-28T10:00:00Z',
    })[0]?.status).toBe('pending_confirmation')
  })
})

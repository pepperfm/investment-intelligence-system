import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contentHash } from '../server/adapters/evidence/http'
import { parseBankDates, parseFullBankForm } from '../server/adapters/evidence/cbr/banks'
import { parseFinOrg } from '../server/adapters/evidence/cbr/finorg'
import { financialCoverage, compareFinancialFacts, type ComparableFact } from '../server/domain/evidence/financials'
import { macroChanges } from '../server/domain/evidence/macro-changes'
import { regulatoryLinks } from '../server/domain/evidence/event-links'
import { checkedRow, extractCbrIncomeHtml, VerifiedDocumentsProvider } from '../server/adapters/evidence/issuer/verified-documents'
import { parseMoneySupply } from '../server/adapters/evidence/cbr/statistics'

function fixture(file: string) {
  const body = readFileSync(new URL(`./fixtures/cbr/${file}`, import.meta.url), 'utf8')
  return {
    body,
    status: 200,
    observedAt: '2026-10-25T13:00:00Z',
    hash: contentHash(body),
    durationMs: 1,
    etag: null,
    lastModified: null,
    cached: false,
  }
}

describe('live CBR bank contracts', () => {
  it('discovers actual available dates and parses complete 101/102 rows for two periods', () => {
    expect(parseBankDates(fixture('dates101.xml').body).slice(0, 2)).toEqual(['2026-09-01', '2026-08-01'])
    const august = parseFullBankForm(fixture('sber-101-2026-08-01.xml'), 101, '1481')
    const september = parseFullBankForm(fixture('sber-101-2026-09-01.xml'), 101, '1481')
    expect(august.rows.length).toBeGreaterThan(20)
    expect(september.rows.length).toBeGreaterThan(20)
    expect(september.rows.find(row => row.numsc === '106')?.iitg).toBe('578401689.0000')
    expect(september.unit).toBe('тыс. RUB')
    expect(parseFullBankForm(fixture('sber-102-2026-09-01.xml'), 102, '1481').rows.find(row => row.symbol === '11000')?.tp3).toBe('5350961046')
    expect(() => parseFullBankForm(fixture('sber-101-2026-09-01.xml'), 101, '9999')).toThrow()
  })
  it('preserves issuer-specific status and both expired and current license records', () => {
    const identity = parseFinOrg(fixture('finorg-sber.xml'), '1027700132195')
    expect(identity).toMatchObject({
      inn: '7707083893',
      regNum: '1481',
      status: 'Active',
    })
    expect(identity.licenses.some(license => license.endDate !== null)).toBe(true)
    expect(identity.licenses.some(license => license.endDate === null)).toBe(true)
    expect(() => parseFinOrg({
      ...fixture('finorg-sber.xml'),
      body: '<GetFullInfoByOGRNResult/>',
    }, '1027700132195')).toThrow()
  })
  it('rejects changed primary PDF bytes before attempting extraction', async () => {
    const provider = new VerifiedDocumentsProvider()
    await expect(provider.extractFacts('yandex-2q26', new TextEncoder().encode('%PDF-changed'), 'ab2c09f8-2a20-451c-9e3d-9787b174811e')).rejects.toThrow('Unverified primary bytes')
  })
  it('checks exact PDF table values and rejects changed rows, without joining adjacent numbers', () => {
    expect(checkedRow(' Выручка     386,3      332,5      759,0      639,0', 'Выручка', ['386.3', '332.5', '759.0', '639.0'])).toHaveLength(4)
    expect(() => checkedRow('Выручка 123 111', 'Выручка', ['124', '111'])).toThrow()
    expect(extractCbrIncomeHtml('<html><body>Сбербанк 1481 тыс. рублей<table><tr><td>Итого по разделу 1</td><td>123 456</td></tr><tr><td>Итого по разделу 2</td><td>789</td></tr></table></body></html>')).toEqual({
      interestIncome: '123456',
      commissionIncome: '789',
    })
  })
})

function facts(year: string, start = '01-01', end = '12-31', bank = false): ComparableFact[] {
  return (bank ? ['net_interest_income', 'net_profit', 'total_assets', 'equity', 'loans', 'deposits'] : ['revenue', 'net_profit', 'debt', 'cash']).map(metricKey => ({
    metricKey,
    value: '100',
    unit: 'млн RUB',
    periodStart: `${year}-${start}`,
    periodEnd: `${year}-${end}`,
    reportingStandard: 'IFRS',
    consolidated: true,
    verification: 'machine_verified',
    basis: 'reported',
  }))
}

describe('industry/period/basis boundaries', () => {
  it('accepts comparable annual, quarter and YTD pairs, never mixes them', () => {
    expect(financialCoverage([...facts('2025'), ...facts('2024')], 'exporter').covered).toBe(true)
    expect(financialCoverage([...facts('2026', '04-01', '06-30'), ...facts('2025', '04-01', '06-30')], 'it').covered).toBe(true)
    expect(financialCoverage([...facts('2026', '01-01', '06-30'), ...facts('2025', '01-01', '06-30')], 'it').covered).toBe(true)
    expect(financialCoverage([...facts('2026', '04-01', '06-30'), ...facts('2025', '01-01', '06-30')], 'it').covered).toBe(false)
    expect(financialCoverage([...facts('2025'), ...facts('2024').map(row => ({
      ...row,
      reportingStandard: 'RAS',
    }))], 'general').covered).toBe(false)
  })
  it('uses bank metrics rather than industrial debt/cash and excludes non-IFRS substitutes', () => {
    expect(financialCoverage([...facts('2025'), ...facts('2024')], 'bank').covered).toBe(false)
    expect(financialCoverage([...facts('2025', '01-01', '12-31', true), ...facts('2024', '01-01', '12-31', true)], 'bank').covered).toBe(true)
    expect(financialCoverage([...facts('2025'), ...facts('2024')].map(row => ({
      ...row,
      basis: 'non_ifrs',
    })), 'exporter').covered).toBe(false)
    expect(financialCoverage([...facts('2025'), ...facts('2024')].map(row => ({
      ...row,
      reportingStandard: 'BANK_REGULATORY',
    })), 'bank').covered).toBe(false)
  })
  it('does not turn missing or nonpositive bases into fabricated growth', () => {
    const values = [...facts('2025'), ...facts('2024')]
    expect(compareFinancialFacts(values).find(row => row.metricKey === 'revenue' && row.periodEnd === '2025-12-31')?.yoyPct).toBe(0)
    expect(compareFinancialFacts(values.map(row => ({
      ...row,
      value: row.periodEnd.startsWith('2024') ? '0' : '100',
    })))[0]?.yoyPct).toBeNull()
    expect(compareFinancialFacts(values.map(row => ({
      ...row,
      unit: row.periodEnd.startsWith('2024') ? 'млн USD' : 'млн RUB',
    })))[0]?.previous).toBeNull()
  })
})

describe('macro lags and regulatory impact', () => {
  it('uses calendar MoM/YoY with periodicity/units guards', () => {
    const current = {
      date: '2026-10-01',
      value: '110',
      unit: 'млрд RUB',
      periodicity: 'monthly',
    }
    expect(macroChanges(current, [{
      ...current,
      date: '2026-09-01',
      value: '100',
    }, {
      ...current,
      date: '2025-10-01',
      value: '100',
    }]).momPct).toBeCloseTo(10)
    expect(macroChanges(current, [{
      ...current,
      date: '2026-08-01',
      value: '100',
    }]).momPct).toBeNull()
    expect(macroChanges({
      ...current,
      periodicity: 'daily',
    }, [{
      ...current,
      date: '2026-09-01',
      value: '100',
    }]).momPct).toBeNull()
    expect(parseMoneySupply(fixture('statistics-m1.json'), 'm1')[0]?.seriesKey).toBe('cbr.money_supply.m1')
  })
  it('keeps rate changes market-wide and does not accuse companies by generic words', () => {
    expect(regulatoryLinks({
      title: 'Банк России снизил ключевую ставку',
      body: '',
      category: 'monetary_policy',
    })).toMatchObject({
      scope: 'market',
      issuerInns: [],
    })
    expect(regulatoryLinks({
      title: 'Обновлены банковские нормативы',
      body: '',
      category: 'banking_regulation',
    })).toMatchObject({
      scope: 'sector',
      sectors: ['bank'],
      issuerInns: [],
    })
    expect(regulatoryLinks({
      title: 'Сбербанк',
      body: '',
      category: 'other',
    }, [{
      inn: '7707083893',
      names: ['Публичное акционерное общество «Сбербанк России»'],
    }]).issuerInns).toEqual([])
  })
})

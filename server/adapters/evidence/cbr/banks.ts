import { provenance as bankProvenance } from './daily'
import type { EvidenceHttpClient } from '../http'
import { parseXml, soapEnvelope } from './xml'

export const BANKS_URL = 'https://www.cbr.ru/CreditInfoWebServ/CreditOrgInfo.asmx'
export const FINORG_URL = 'https://www.cbr.ru/FO_ZoomWS/FinOrg.asmx'

export function fetchCbrSoap(http: EvidenceHttpClient, url: string, operation: string, params: Record<string, string>) {
  return http.request(url, {
    method: 'POST',
    idempotent: true,
    headers: {
      'content-type': 'text/xml; charset=utf-8',
      'soapaction': `"http://web.cbr.ru/${operation}"`,
    },
    body: soapEnvelope(operation, params),
  })
}

export function parseBankIdentities(body: string) {
  const $ = parseXml(body)
  return $('EnumCredits').toArray().map(node => ({
    name: $(node).find('OrgName').text(),
    regNum: $(node).find('cregnum').text(),
    intCode: $(node).find('IntCode').text(),
    ogrn: $(node).find('OGRN').text() || null,
  })).filter(bank => bank.name && /^\d+$/.test(bank.regNum) && /^\d+$/.test(bank.intCode))
}

/** Raw rows only. No guessed accounts/ratios or inference from an empty response. */
export function parseBankForm(body: string) {
  const $ = parseXml(body)
  return $('FD, F102').toArray().map(node => Object.fromEntries($(node).children().toArray().map(child => [child.type === 'tag' ? child.name : '', $(child).text()])))
}

export function parseBankDates(body: string): string[] {
  const $ = parseXml(body)
  return [...new Set($('dateTime').toArray().map(node => $(node).text().slice(0, 10)))]
    .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date))).sort().reverse()
}

export function parseFullBankForm(response: import('../http').SourceResponse, form: 101 | 102, expectedRegNum: string): import('../../../../shared/types/evidence').BankFormSnapshot {
  const $ = parseXml(response.body)
  const root = $(form === 101 ? 'F101FNew' : 'F102FNew')
  const regNum = root.attr('regnum') ?? ''
  const reportDate = root.attr('dt') ?? ''
  if (regNum !== expectedRegNum || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    throw new Error('Unexpected bank form identity/date')
  }
  const rows = root.find(form === 101 ? 'F101' : 'F102').toArray().map(node => Object.fromEntries($(node).children().toArray().map(child => [child.type === 'tag' ? child.name : '', $(child).text().trim()])))
  if (!rows.length) {
    throw new Error('Bank form has no published rows')
  }
  return {
    form,
    regNum,
    reportDate,
    standard: 'BANK_REGULATORY',
    consolidated: false,
    // Units verified against official CBR f101/f102 HTML forms (0409101/0409102), 25.10.2026. No derived ratios.
    unit: 'тыс. RUB',
    rows,
    provenance: bankProvenance(response, 'cbr_banks', `https://www.cbr.ru/banking_sector/credit/coinfo/f${form}?regnum=${regNum}&dt=${reportDate.replaceAll('-', '')}`, `${regNum}:${form}:${reportDate}`, rows),
  }
}

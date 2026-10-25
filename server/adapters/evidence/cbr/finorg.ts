import type { RegulatoryIdentitySnapshot } from '../../../../shared/types/evidence'
import type { SourceResponse } from '../http'
import { FINORG_URL } from './banks'
import { provenance } from './daily'
import { parseXml } from './xml'

/** Status is taken only from an identity-matched successful record; absent results never mean revocation. */
export function parseFinOrg(response: SourceResponse, expectedOgrn: string): RegulatoryIdentitySnapshot {
  const $ = parseXml(response.body)
  const root = $('GetFullInfoByOGRNResult')
  if (root.find('Error').text().trim() || root.find('OGRN').first().text() !== expectedOgrn) {
    throw new Error('FinOrg identity is absent or mismatched')
  }
  const date = (value: string) => value && Number.isFinite(Date.parse(value)) ? value.slice(0, 10) : null
  const rawStatus = root.children('Status').text()
  const payload: Omit<RegulatoryIdentitySnapshot, 'provenance'> = {
    inn: root.children('INN').text(),
    ogrn: expectedOgrn,
    name: root.children('Name').text(),
    regNum: root.children('REGNUM').text() || null,
    status: rawStatus === 'Active' || rawStatus === 'NotActive' ? rawStatus : null,
    bankStatus: root.children('BnkStatus').text() || null,
    licenses: root.find('LicList > LicInfo').toArray().map(node => ({
      activity: $(node).find('VidD').text(),
      number: $(node).find('LIC_Number').text() || null,
      name: $(node).find('LIC_Name').text(),
      startDate: date($(node).find('LIC_DTStart').text()),
      endDate: date($(node).find('LIC_DTEnd').text()),
    })),
  }
  if (!/^\d{10}(\d{2})?$/.test(payload.inn) || !payload.name) {
    throw new Error('Incomplete FinOrg identity')
  }
  return {
    ...payload,
    provenance: provenance(response, 'cbr_finorg', FINORG_URL, expectedOgrn, payload),
  }
}

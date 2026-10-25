/** Read-only official CBR smoke. Run: bun scripts/data-sources/smoke.ts [--record]. No credentials or DB. */
import { mkdir } from 'node:fs/promises'
import { EvidenceHttpClient } from '../../server/adapters/evidence/http'
import { fetchKeyRate, parseKeyRate, parseFx, DAILY_URL, FX_URL } from '../../server/adapters/evidence/cbr/daily'
import { fetchStatisticsCatalog, STATISTICS_URL, parseMoneySupply } from '../../server/adapters/evidence/cbr/statistics'
import { parseCbrRss, CBR_RSS_URL } from '../../server/adapters/evidence/cbr/rss'
import { fetchCbrSoap, BANKS_URL, FINORG_URL, parseBankIdentities, parseFullBankForm } from '../../server/adapters/evidence/cbr/banks'
import { parseXml } from '../../server/adapters/evidence/cbr/xml'
import { parseFinOrg } from '../../server/adapters/evidence/cbr/finorg'

const http = new EvidenceHttpClient()
const now = new Date()
const record = process.argv.includes('--record')
const results: Record<string, unknown>[] = []
const probes = [
  {
    name: 'keyrate',
    url: DAILY_URL,
    fetch: () => fetchKeyRate(http, new Date(now.getTime() - 30 * 86400_000).toISOString(), now.toISOString()),
    parse: (body: Awaited<ReturnType<typeof http.request>>) => parseKeyRate(body).length,
  },
  {
    name: 'fx',
    url: FX_URL,
    fetch: () => http.request(FX_URL),
    parse: (body: Awaited<ReturnType<typeof http.request>>) => parseFx(body).length,
  },
  {
    name: 'data',
    url: `${STATISTICS_URL}data?publicationId=5&datasetId=7&y1=${now.getUTCFullYear()}&y2=${now.getUTCFullYear()}`,
    fetch: () => http.request(`${STATISTICS_URL}data?publicationId=5&datasetId=7&y1=${now.getUTCFullYear()}&y2=${now.getUTCFullYear()}`),
    parse: (body: Awaited<ReturnType<typeof http.request>>) => parseMoneySupply(body).length,
  },
  {
    name: 'rss',
    url: CBR_RSS_URL,
    fetch: () => http.request(CBR_RSS_URL),
    parse: (body: Awaited<ReturnType<typeof http.request>>) => parseCbrRss(body).length,
  },
  {
    name: 'bank-search',
    url: BANKS_URL,
    fetch: () => fetchCbrSoap(http, BANKS_URL, 'SearchByNameXML', { NamePart: 'Сбербанк' }),
    parse: (body: Awaited<ReturnType<typeof http.request>>) => parseBankIdentities(body.body).length,
  },
  {
    name: 'bank-full-101',
    url: BANKS_URL,
    fetch: () => fetchCbrSoap(http, BANKS_URL, 'Data101FNewXML', {
      CredorgNumber: '1481',
      Dt: '2026-09-01T00:00:00',
    }),
    parse: (body: Awaited<ReturnType<typeof http.request>>) => parseFullBankForm(body, 101, '1481').rows.length,
  },
  {
    name: 'bank-full-102',
    url: BANKS_URL,
    fetch: () => fetchCbrSoap(http, BANKS_URL, 'Data102FXML', {
      CredorgNumber: '1481',
      dt: '2026-09-01T00:00:00',
    }),
    parse: (body: Awaited<ReturnType<typeof http.request>>) => parseFullBankForm(body, 102, '1481').rows.length,
  },
  {
    name: 'finorg-update',
    url: FINORG_URL,
    fetch: () => fetchCbrSoap(http, FINORG_URL, 'GetLastUpdate', {}),
    parse: (body: Awaited<ReturnType<typeof http.request>>) => parseXml(body.body)('GetLastUpdateResult').text(),
  },
  {
    name: 'finorg-sber',
    url: FINORG_URL,
    fetch: () => fetchCbrSoap(http, FINORG_URL, 'GetFullInfoByOGRN', { OGRN: '1027700132195' }),
    parse: (body: Awaited<ReturnType<typeof http.request>>) => parseFinOrg(body, '1027700132195').licenses.length,
  },
]
try {
  const catalog = await fetchStatisticsCatalog(http)
  results.push({
    name: 'catalog',
    publications: catalog.publications.length,
    datasets: catalog.datasets.length,
    status: 'ok',
    checkedAt: now.toISOString(),
  })
} catch (error) {
  results.push({
    name: 'catalog',
    status: 'unavailable',
    error: error instanceof Error ? error.message : 'unknown',
  })
}
for (const probe of probes) {
  try {
    const response = await probe.fetch()
    const count = probe.parse(response)
    const result = {
      name: probe.name,
      url: probe.url,
      status: response.status,
      count,
      hash: response.hash,
      checkedAt: response.observedAt,
    }
    results.push(result)
    console.log(JSON.stringify(result))
    if (record) {
      await mkdir('tests/fixtures/cbr', { recursive: true })
      await Bun.write(`tests/fixtures/cbr/${probe.name}.${probe.name === 'data' ? 'json' : 'xml'}`, response.body)
    }
  } catch (error) {
    const result = {
      name: probe.name,
      url: probe.url,
      status: 'unavailable',
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'unknown',
    }
    results.push(result)
    console.log(JSON.stringify(result))
  }
}
if (record) {
  await mkdir('docs/data-sources', { recursive: true })
  await Bun.write('docs/data-sources/smoke.json', JSON.stringify(results, null, 2) + '\n')
}
if (results.some(result => result.status === 'unavailable')) {
  process.exitCode = 1
}

import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

/** Manual, read-only contract probe. Never imports app bootstrap or touches the DB. */
if (!process.argv.includes('--live')) {
  console.log('Usage: bun scripts/calendar-smoke.ts --live [--record] (market data only; no orders or AI)')
  process.exit(0)
}
const symbols = ['ROSN', 'NVTK', 'TATN', 'SBER', 'GAZP', 'IMOEX']
const retrievedAt = new Date().toISOString()
const interval = {
  start: '2026-09-18T00:00:00Z',
  end: '2026-09-30T00:00:00Z',
}
async function read(url: string, token?: string) {
  const observedAt = new Date().toISOString()
  try {
    const response = await fetch(url, {
      headers: token ? { Authorization: token } : undefined,
      signal: AbortSignal.timeout(25_000),
    })
    if (!response.ok) {
      return {
        status: response.status,
        observedAt,
        sourceResponseHash: null,
        body: null,
      }
    }
    const raw = await response.text()
    return {
      status: response.status,
      observedAt,
      sourceResponseHash: createHash('sha256').update(raw).digest('hex'),
      body: JSON.parse(raw),
    }
  } catch {
    return {
      status: null,
      observedAt,
      sourceResponseHash: null,
      body: null,
    }
  }
}
let token: string | undefined
if (process.env.NUXT_FINAM_READ_SECRET) {
  try {
    const response = await fetch('https://api.finam.ru/v1/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: process.env.NUXT_FINAM_READ_SECRET }),
      signal: AbortSignal.timeout(20_000),
    })
    if (response.ok) {
      token = ((await response.json()) as { token?: string }).token
    }
  } catch { /* Only safe status summaries leave this process. */ }
}
const results = []
for (const symbol of symbols) {
  const market = symbol === 'IMOEX' ? 'index' : 'shares'
  const board = symbol === 'IMOEX' ? 'SNDX' : 'TQBR'
  const params = new URLSearchParams({
    'timeframe': 'TIME_FRAME_D',
    'interval.start_time': interval.start,
    'interval.end_time': interval.end,
  })
  const finamUrl = `https://api.finam.ru/v1/instruments/${symbol}%40MISX/bars?${params}`
  const finam = token
    ? await read(finamUrl, token)
    : {
        status: null,
        observedAt: new Date().toISOString(),
        sourceResponseHash: null,
        body: null,
      }
  const finamBody = finam.body as { bars?: Record<string, unknown>[] } | null
  // Fixed allowlist: no auth response, account information, headers or opaque server error bodies.
  const bars = finamBody?.bars?.map(b => Object.fromEntries(['timestamp', 'open', 'high', 'low', 'close', 'volume'].map(k => [k, b[k]]))) ?? []
  const moexUrl = `https://iss.moex.com/iss/engines/stock/markets/${market}/boards/${board}/securities/${symbol}/candles.json?from=2026-09-18&till=2026-09-29&interval=24&iss.meta=off`
  const moex = await read(moexUrl)
  const moexBody = moex.body as {
    candles?: {
      columns: string[]
      data: unknown[][]
    }
  } | null
  const admissionUrl = `https://iss.moex.com/iss/engines/stock/markets/${market}/boards/${board}/securities/${symbol}.json?iss.meta=off&iss.only=securities&securities.columns=SECID,BOARDID,TRADINGSESSION`
  const admission = await read(admissionUrl)
  const admissionBody = admission.body as {
    securities?: {
      columns: string[]
      data: unknown[][]
    }
  } | null
  results.push({
    symbol,
    board,
    market,
    finam: {
      url: finamUrl,
      status: finam.status,
      observedAt: finam.observedAt,
      sourceResponseHash: finam.sourceResponseHash,
      bars,
    },
    moex: {
      url: moexUrl,
      status: moex.status,
      observedAt: moex.observedAt,
      sourceResponseHash: moex.sourceResponseHash,
      candles: moexBody?.candles ?? null,
    },
    currentAdmission: {
      url: admissionUrl,
      status: admission.status,
      securities: admissionBody?.securities ?? null,
      historicalAdmissionVerified: false,
    },
  })
}
const result = {
  schemaVersion: 2,
  retrievedAt,
  interval,
  verdict: 'data_quality_blocked',
  reason: 'Raw timestamp/OHLCV alone does not prove daily aggregation, session overlap, completion or historical instrument admission.',
  results,
}
if (process.argv.includes('--record')) {
  const dir = resolve(import.meta.dir, '../tests/fixtures/calendar')
  await mkdir(dir, { recursive: true })
  await writeFile(resolve(dir, 'daily-feed-probe-v2.json'), `${JSON.stringify(result, null, 2)}\n`)
}
console.log(JSON.stringify({
  retrievedAt,
  results: results.map(r => ({
    symbol: r.symbol,
    finamStatus: r.finam.status,
    finamBars: r.finam.bars.length,
    moexStatus: r.moex.status,
    moexBars: r.moex.candles?.data.length ?? 0,
    admissionStatus: r.currentAdmission.status,
  })),
  verdict: result.verdict,
}))

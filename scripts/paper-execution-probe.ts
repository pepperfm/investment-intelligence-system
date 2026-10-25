import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

if (!process.argv.includes('--live')) {
  console.log('Usage: bun scripts/paper-execution-probe.ts --live [--record] (read quotes only; never orders)')
  process.exit(0)
}
const symbols = ['TATN', 'SBER']
const startedAt = new Date().toISOString()
async function read(url: string, token?: string) {
  const observedAt = new Date().toISOString()
  const start = performance.now()
  try {
    const response = await fetch(url, {
      headers: token ? { Authorization: token } : undefined,
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) {
      return {
        observedAt,
        receivedAt: new Date().toISOString(),
        elapsedMs: Math.round(performance.now() - start),
        status: response.status,
        hash: null,
        body: null,
      }
    }
    const text = await response.text()
    return {
      observedAt,
      receivedAt: new Date().toISOString(),
      elapsedMs: Math.round(performance.now() - start),
      status: response.status,
      hash: createHash('sha256').update(text).digest('hex'),
      body: JSON.parse(text) as Record<string, unknown>,
    }
  } catch {
    return {
      observedAt,
      receivedAt: new Date().toISOString(),
      elapsedMs: Math.round(performance.now() - start),
      status: null,
      hash: null,
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
  } catch { /* No authentication responses or credentials are logged or saved. */ }
}
const results = []
for (const ticker of symbols) {
  const finamEndpoint = `https://api.finam.ru/v1/instruments/${ticker}%40MISX/quotes/latest`
  const finam = token ? await read(finamEndpoint, token) : null
  const rawQuote = finam?.body?.quote && typeof finam.body.quote === 'object' ? finam.body.quote as Record<string, unknown> : finam?.body ?? {}
  const quote = Object.fromEntries(['timestamp', 'bid', 'ask', 'bid_size', 'ask_size', 'last', 'volume', 'last_trade_time', 'last_price', 'best_bid', 'best_ask'].filter(k => rawQuote[k] !== undefined).map(k => [k, rawQuote[k]]))
  const moexEndpoint = `https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities/${ticker}.json?iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,BOARDID,BID,OFFER,LAST,UPDATETIME,SYSTIME,TRADINGSTATUS,LCURRENTPRICE`
  const moex = await read(moexEndpoint)
  results.push({
    ticker,
    board: 'TQBR',
    finam: {
      endpoint: finamEndpoint,
      observedAt: finam?.observedAt ?? null,
      receivedAt: finam?.receivedAt ?? null,
      status: finam?.status ?? null,
      sourceResponseHash: finam?.hash ?? null,
      requestElapsedMs: finam?.elapsedMs ?? null,
      quote,
    },
    moex: {
      endpoint: moexEndpoint,
      observedAt: moex.observedAt,
      receivedAt: moex.receivedAt,
      status: moex.status,
      sourceResponseHash: moex.hash,
      requestElapsedMs: moex.elapsedMs,
      marketdata: moex.body?.marketdata ?? null,
    },
  })
}
const result = {
  schemaVersion: 1,
  startedAt,
  capturedAt: new Date().toISOString(),
  status: 'not_ready_for_paper_execution',
  executionPolicyVersion: null,
  maxAgeSecondsCandidate: 60,
  actualOrderCreated: false,
  actualFillCreated: false,
  results,
  reasons: ['Quote observation during a no-trading weekend does not prove an executable after-confirmation price.', 'Single snapshots and HTTP latency do not establish exchange feed delay, quote validity or a versioned fill model.', 'Historical OHLC and last price remain indicative; no fallback to reconstructed fills.'],
  requiredNextEvidence: ['Repeated active-session bid/ask observations with explicit provider timestamps, session/board, freshness bound and latency policy.', 'Separate tested observed-quote execution policy and explicit user reconfirmation; neither research policy nor this probe authorizes a fill.'],
}
if (process.argv.includes('--record')) {
  const directory = resolve(import.meta.dir, '../docs/market-data')
  await mkdir(directory, { recursive: true })
  await writeFile(resolve(directory, 'paper-execution-probe-2026-10-25.json'), JSON.stringify(result, null, 2) + '\n')
}
console.log(JSON.stringify(result))

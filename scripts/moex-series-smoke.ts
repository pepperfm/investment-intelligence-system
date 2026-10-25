import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { MoexIssResearchProvider } from '../server/adapters/market/moex-iss'

if (!process.argv.includes('--live')) {
  console.log('Usage: bun scripts/moex-series-smoke.ts --live [--record]')
  process.exit(0)
}
const provider = new MoexIssResearchProvider()
const results = []
for (const [ticker, kind] of [['ROSN', 'equity'], ['IMOEX', 'index']] as const) {
  const startedAt = Date.now()
  try {
    const result = await provider.getSeries({
      ticker,
      kind,
      currency: 'RUB',
    }, '2024-01-01', '2026-10-23')
    const summary = {
      ticker,
      kind,
      from: result.from,
      to: result.to,
      board: result.board,
      market: result.market,
      observedAt: result.observedAt,
      sourceRevision: result.sourceRevision,
      durationMs: Date.now() - startedAt,
      pages: result.responses.length,
      dailyRows: result.responses.filter(r => r.interval === 24).reduce((n, r) => n + r.data.length, 0),
      hourlyRows: result.responses.filter(r => r.interval === 60).reduce((n, r) => n + r.data.length, 0),
      statuses: Object.fromEntries(['research_usable_with_limits', 'quarantined', 'pending_confirmation'].map(status => [status, result.assessments.filter(a => a.status === status).length])),
      quarantined: result.assessments.filter(a => a.status === 'quarantined').map(a => ({
        date: a.date,
        issues: a.issues,
      })),
      firstDate: result.assessments[0]?.date,
      lastDate: result.assessments.at(-1)?.date,
    }
    results.push(summary)
    console.log(JSON.stringify(summary))
  } catch (error) {
    const summary = {
      ticker,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'source unavailable',
    }
    results.push(summary)
    console.log(JSON.stringify(summary))
  }
}
if (process.argv.includes('--record')) {
  const dir = resolve(import.meta.dir, '../tmp')
  await mkdir(dir, { recursive: true })
  await writeFile(resolve(dir, 'moex-series-smoke.json'), `${JSON.stringify({
    capturedAt: new Date().toISOString(),
    results,
  }, null, 2)}\n`)
}

import postgres from 'postgres'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { evaluateSignal } from '../server/domain/strategies/rules'
import { PHYSICAL_POLICY_VERSION } from '../server/domain/market/source-policy'
import { rulesHash } from '../server/domain/strategies/pinned'
import type { Candle, StrategyId, StrategyRules } from '../shared/types/investment'

if (!process.argv.includes('--read-only')) {
  console.log('Usage: bun scripts/research-setup-scan.ts --read-only [--record]')
  process.exit(0)
}
const connection = process.env.IIS_READ_DATABASE_URL ?? 'postgres://app:app@127.0.0.1:5442/iis_finam'
const database = new URL(connection)
if (!['127.0.0.1', 'localhost'].includes(database.hostname)) {
  throw new Error('Local read-only scan only')
}
const sql = postgres(connection, { max: 1 })
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
interface Assessment {
  date: string
  status: string
  candle: Candle | null
  issues: string[]
}
interface Audit {
  id: string
  instrument_id: string
  source_revision: string
  policy_version: string
  observed_at: Date
  ticker: string
  board: string
  payload: { assessments: Assessment[] }
}
interface Version {
  id: string
  strategy_id: StrategyId
  version: number
  rules: StrategyRules
}
const now = new Date()
const report = await sql.begin('read only', async (tx) => {
  const versions = await tx<Version[]>`select id,strategy_id,version,rules from strategy_versions where status='active' order by strategy_id`
  const audits = await tx<Audit[]>`select distinct on (a.instrument_id) a.id,a.instrument_id,a.source_revision,a.policy_version,a.observed_at,a.board,a.payload,i.ticker from bar_quality_audits a join instruments i on i.id=a.instrument_id where a.source='moex_iss' and a.policy_id='physical_session_v1' order by a.instrument_id,a.observed_at desc`
  const normalized = await tx<{
    audit_id: string
    session_date: string
    candle: Candle
  }[]>`select audit_id,session_date,candle from normalized_market_bars where audit_id in ${tx(audits.map(a => a.id))}`
  const normalizedByKey = new Map(normalized.map(row => [`${row.audit_id}:${row.session_date}`, row.candle]))
  const benchmark = audits.find(a => a.ticker === 'IMOEX')
  function window(audit: Audit, asOf: Date, required: number) {
    const selected = audit.payload.assessments.filter(a => Date.parse(a.date + 'T00:00:00+03:00') + 2 * 86_400_000 <= asOf.getTime()).slice(-required)
    const issues = selected.filter(a => a.status !== 'research_usable_with_limits' || !a.candle).flatMap(a => a.issues.length ? a.issues.map(reason => `${a.date}:${reason}`) : [`${a.date}:${a.status}`])
    if (audit.policy_version !== PHYSICAL_POLICY_VERSION) {
      issues.push('source_policy_version_mismatch')
    }
    for (const assessment of selected) {
      const normalizedCandle = normalizedByKey.get(`${audit.id}:${assessment.date}`)
      if (!normalizedCandle || hash(normalizedCandle) !== hash(assessment.candle)) {
        issues.push(`${assessment.date}:normalized_revision_hash_mismatch`)
      }
    }
    if (selected.length < required) {
      issues.push(`required_window:${selected.length}/${required}`)
    }
    return {
      selected,
      issues,
      bars: issues.length ? [] : selected.map(a => a.candle!),
    }
  }
  const positives = []
  const latest = []
  let checked = 0
  for (const audit of audits.filter(a => a.ticker !== 'IMOEX')) {
    for (const version of versions) {
      const required = Math.max(210, version.rules.slowSma, version.rules.trendSma, version.rules.momentumLookback + 1, version.rules.breakoutLookback + 1, version.rules.regimeSma ?? 0)
      const dates = [now, ...audit.payload.assessments.map(a => new Date(Date.parse(`${a.date}T00:00:00Z`) + 2 * 86_400_000 + 21 * 3_600_000 - 1000)).filter(d => d < now).reverse()]
      let found = 0
      for (let index = 0; index < dates.length; index++) {
        const asOf = dates[index]!
        const data = window(audit, asOf, required)
        const bench = benchmark ? window(benchmark, asOf, required) : null
        checked++
        const mandatory = (version.rules.regimeSma ?? 0) > 0
        const eligible = !data.issues.length && (!mandatory || (!!bench && !bench.issues.length))
        const signal = eligible ? evaluateSignal(version.strategy_id, version.rules, data.bars, bench?.bars ?? []) : null
        const row = {
          ticker: audit.ticker,
          board: audit.board,
          instrumentId: audit.instrument_id,
          asOf: asOf.toISOString(),
          lastPhysicalDate: data.bars.at(-1)?.ts.slice(0, 10) ?? null,
          auditId: audit.id,
          sourceRevision: audit.source_revision,
          observedAt: audit.observed_at.toISOString(),
          policyId: 'physical_session_v1',
          inputHash: hash(data.selected),
          requiredBars: required,
          bars: data.bars.length,
          strategy: version.strategy_id,
          strategyVersionId: version.id,
          version: version.version,
          rulesHash: rulesHash(version.rules),
          rules: version.rules,
          benchmarkRequired: mandatory,
          benchmarkAuditId: benchmark?.id ?? null,
          benchmarkIssues: bench?.issues ?? ['benchmark_missing'],
          qualityIssues: data.issues,
          setup: signal?.setup ?? null,
          setupType: signal?.setupType ?? null,
          reasons: signal?.reasons ?? [],
          failures: signal?.failures ?? [],
          metrics: signal?.metrics ?? null,
        }
        if (index === 0) {
          latest.push(row)
        }
        if (signal?.setup) {
          positives.push(row)
          found++
        }
        if (found >= 3) {
          break
        }
      }
    }
  }
  const candidate = latest.find(row => row.ticker === 'TATN' && row.strategy === 'swing' && row.setup)
  const candidateAudit = candidate ? audits.find(audit => audit.id === candidate.auditId) : null
  const candidateFixture = candidate && candidateAudit
    ? {
        source: 'immutable real MOEX audit, read-only local selection',
        candidate,
        bars: window(candidateAudit, new Date(candidate.asOf), candidate.requiredBars).bars,
        benchmarkStatus: 'blocked',
        warning: 'Frozen candidate is a selected routing example, not an independent strategy-performance test.',
      }
    : null
  return {
    capturedAt: now.toISOString(),
    database: database.pathname.slice(1),
    selectionMethod: 'Latest immutable MOEX audit per symbol; unchanged active rules; each candidate requires last N eligible assessments with no quarantines removed. Newest three positive dates per symbol/version, selected only to test routing, not profitability.',
    checkedWindows: checked,
    positiveCount: positives.length,
    latest,
    positives,
    candidateFixture,
  }
})
await sql.end()
if (process.argv.includes('--record')) {
  const dir = resolve(import.meta.dir, '../tmp')
  await mkdir(dir, { recursive: true })
  await writeFile(resolve(dir, 'research-positive-setup-scan.json'), JSON.stringify(report, null, 2) + '\n')
  if (report.candidateFixture) {
    const fixtureDir = resolve(import.meta.dir, '../tests/fixtures/calendar')
    await mkdir(fixtureDir, { recursive: true })
    await writeFile(resolve(fixtureDir, 'research-positive-tatn-2026-10-25.json'), JSON.stringify(report.candidateFixture, null, 2) + '\n')
  }
}
console.log(JSON.stringify({
  checkedWindows: report.checkedWindows,
  positiveCount: report.positiveCount,
  latest: report.latest.map(r => ({
    ticker: r.ticker,
    strategy: r.strategy,
    setup: r.setup,
    failures: r.failures,
    qualityIssues: r.qualityIssues,
    benchmarkIssues: r.benchmarkIssues,
  })),
  candidates: report.positives.slice(0, 12).map(r => ({
    ticker: r.ticker,
    strategy: r.strategy,
    asOf: r.asOf,
    lastPhysicalDate: r.lastPhysicalDate,
    setup: r.setup,
    auditId: r.auditId,
    inputHash: r.inputHash,
    benchmarkIssues: r.benchmarkIssues,
  })),
}))

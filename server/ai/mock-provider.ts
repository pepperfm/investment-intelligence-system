import type { AnalystOutput, CriticOutput, OutcomeReviewOutput, ResearchOutput } from '../../shared/schemas/investment'
import type { EvidenceItem } from '../../shared/types/investment'
import { fmt, pct } from '../domain/strategies/rules'
import type { CriticClaims, EvidencePacket, OutcomePacket } from './contracts'
import type { AgentProvider, AgentRequest, AgentResult, ProviderHealth } from './provider'

const INJECTION = /ignore (all |previous )?instructions|system:|disregard|recommend buying/i

/**
 * Deterministic offline analyst. It applies transparent heuristics to the packet so the whole
 * pipeline (including the critic gate) is exercisable without any LLM. Its output passes the same
 * schema validation as real providers.
 */
export class MockProvider implements AgentProvider {
  readonly id = 'mock' as const

  async health(): Promise<ProviderHealth> {
    return {
      id: this.id,
      available: true,
      version: 'mock-analyst-1',
      error: null,
    }
  }

  async run<T>(request: AgentRequest<T>): Promise<AgentResult<T>> {
    const started = Date.now()
    let output: unknown
    switch (request.role) {
      case 'market_researcher':
        output = research(request.packet as EvidencePacket)
        break
      case 'hypothesis_analyst': {
        const { evidence, research: findings } = request.packet as {
          evidence: EvidencePacket
          research: ResearchOutput
        }
        output = analyse(evidence, findings)
        break
      }
      case 'hypothesis_critic': {
        const { evidence, claims } = request.packet as {
          evidence: EvidencePacket
          claims: CriticClaims
        }
        output = critique(evidence, claims)
        break
      }
      case 'outcome_reviewer':
        output = review(request.packet as OutcomePacket)
        break
    }
    return {
      output: request.schema.parse(output),
      provider: this.id,
      durationMs: Date.now() - started,
      raw: output,
    }
  }
}

function research(p: EvidencePacket): ResearchOutput {
  const m = p.metrics
  const observations: EvidenceItem[] = [
    {
      claim: `Цена ${fmt(m.close)}, SMA50 ${fmt(m.sma50)}, SMA200 ${fmt(m.sma200)}, RSI14 ${m.rsi14?.toFixed(1) ?? '—'}`,
      sourceIds: ['metrics'],
    },
    {
      claim: `Моментум 20/60/120 дн.: ${pct(m.momentum20)} / ${pct(m.momentum60)} / ${pct(m.momentum120)}; индекс за 60 дн. ${pct(p.benchmark.momentum60)}`,
      sourceIds: ['metrics', 'candles'],
    },
    {
      claim: `Средний дневной оборот ${fmt(m.avgTurnover20)} ₽, годовая волатильность ${pct(m.volatility60)}`,
      sourceIds: ['metrics'],
    },
  ]
  const growth: EvidenceItem[] = []
  const risks: EvidenceItem[] = []
  for (const reason of p.signal.reasons) {
    growth.push({
      claim: reason,
      sourceIds: ['metrics'],
    })
  }
  for (const failure of p.signal.failures) {
    risks.push({
      claim: failure,
      sourceIds: ['metrics'],
    })
  }
  for (const event of p.events.slice(0, 6)) {
    if (INJECTION.test(event.body)) {
      risks.push({
        claim: `Источник «${event.title}» содержит текст, похожий на инструкцию для модели; содержимое проигнорировано как управляющее`,
        sourceIds: [event.id],
      })
      continue
    }
    const target = (event.sentiment ?? 0) >= 0 ? growth : risks
    target.push({
      claim: `${event.title} (${event.publishedAt.slice(0, 10)})`,
      sourceIds: [event.id],
    })
  }
  const latest = p.reports[0]
  if (latest) {
    const debt = latest.metrics.debtToEbitda ?? 0
    const item = {
      claim: `Отчёт ${latest.period}: чистая маржа ${pct(latest.metrics.netMargin)}, долг/EBITDA ${debt}, P/E ${latest.metrics.pe}`,
      sourceIds: [latest.id],
    }
    if (debt > 2) {
      risks.push(item)
    } else {
      growth.push(item)
    }
  }
  if ((m.atrPct ?? 0) > 0.035) {
    risks.push({
      claim: `Высокий дневной диапазон: ATR ${pct(m.atrPct)} от цены`,
      sourceIds: ['metrics'],
    })
  }
  const gaps: string[] = []
  if (!p.reports.length) {
    gaps.push('Нет финансовой отчётности в пакете данных')
  }
  if (!p.events.length) {
    gaps.push('Нет новостей/корпоративных событий за период')
  }
  if (!p.memory.length) {
    gaps.push('Нет похожих прошлых ситуаций в памяти')
  }
  return {
    observations,
    growthFactors: growth.slice(0, 15),
    riskFactors: risks.slice(0, 15),
    dataGaps: gaps,
    coverageGaps: p.coverageGaps ?? [],
  }
}

function analyse(p: EvidencePacket, r: ResearchOutput): AnalystOutput {
  const long = p.signal.setup && p.mode === 'research' ? r.growthFactors.length >= r.riskFactors.length : p.signal.setup && r.riskFactors.length < 2
  const direction = long ? 'long' : 'no_trade'
  const confidence = Math.max(0.1, Math.min(0.85, 0.45 + 0.05 * (r.growthFactors.length - r.riskFactors.length) - 0.07 * r.dataGaps.length))
  const thesis = direction === 'long'
    ? `${p.instrument.name}: сетап «${p.signal.setupType}» стратегии ${p.strategy.name}. Покупка обоснована техническими условиями и доступными свидетельствами; уровни условного сценария заданы кодом.`
    : `${p.instrument.name}: покупка по стратегии ${p.strategy.name} сейчас не обоснована — ${(p.signal.failures[0] ?? 'аргументы против перевешивают').toLowerCase()}.`
  return {
    recommendation: direction,
    decisionThesis: thesis,
    decisionBasis: direction === 'long' ? ['positive_evidence'] : ['contradictory_signals'],
    decisionConfidence: Math.round(confidence * 100) / 100,
    priceForecast: null,
    coverageGaps: p.coverageGaps ?? [],
    direction,
    thesis,
    supportingEvidence: (direction === 'long' ? r.growthFactors : r.riskFactors).slice(0, 6),
    counterEvidence: (direction === 'long' ? r.riskFactors : r.growthFactors).slice(0, 6),
    assumptions: [
      'Рыночный режим (тренд индекса) сохранится на горизонте',
      'Ликвидность позволит войти и выйти без существенного проскальзывания',
    ],
    invalidationConditions: [
      `Закрытие ниже ${fmt(p.signal.stopLoss)}`,
      `Цель не достигнута за ${p.strategy.rules.horizonDays} торговых дн.`,
      'Существенное негативное корпоративное событие',
    ],
    riskNotes: r.riskFactors.slice(0, 5).map(f => f.claim),
    alternatives: ['Остаться в кэше', 'Индексный фонд на IMOEX', 'Уменьшенный размер позиции'],
    confidence: Math.round(confidence * 100) / 100,
    entryNote: `Вход на открытии следующей сессии около ${fmt(p.signal.entry)}`,
    exitNote: `Стоп ${fmt(p.signal.stopLoss)}, цель ${fmt(p.signal.takeProfit)}, выход по времени через ${p.strategy.rules.horizonDays} дн.`,
  }
}

function critique(p: EvidencePacket, claims: CriticClaims): CriticOutput {
  const findings: CriticOutput['findings'] = []
  const m = p.metrics
  const missing: string[] = []
  if (claims.direction === 'long') {
    if ((m.rsi14 ?? 50) > 68) {
      findings.push({
        severity: 'warning',
        topic: 'Перекупленность',
        detail: `RSI14 ${m.rsi14?.toFixed(1)}: вход на перегреве, высок риск отката`,
        sourceIds: ['metrics'],
      })
    }
    if ((p.benchmark.momentum60 ?? 0) < -0.05) {
      findings.push({
        severity: 'warning',
        topic: 'Рыночный фон',
        detail: `Индекс за 60 дн. ${pct(p.benchmark.momentum60)}: покупка против рынка`,
        sourceIds: ['metrics'],
      })
    }
    const negative = p.events.filter(e => (e.sentiment ?? 0) < -0.4)
    if (negative.length >= 2) {
      findings.push({
        severity: 'critical',
        topic: 'Негативные события',
        detail: `${negative.length} негативных событий за период не опровергнуты тезисом`,
        sourceIds: negative.slice(0, 3).map(e => e.id),
      })
    }
    if (claims.counterEvidence.length === 0) {
      findings.push({
        severity: 'warning',
        topic: 'Односторонность',
        detail: 'Тезис не содержит контраргументов',
        sourceIds: [],
      })
    }
    const report = p.reports[0]
    if (report && (report.metrics.debtToEbitda ?? 0) > 2.5) {
      findings.push({
        severity: 'warning',
        topic: 'Долговая нагрузка',
        detail: `Долг/EBITDA ${report.metrics.debtToEbitda} в отчёте ${report.period}`,
        sourceIds: [report.id],
      })
    }
  }
  for (const event of p.events) {
    if (INJECTION.test(event.body)) {
      findings.push({
        severity: 'info',
        topic: 'Подозрительный источник',
        detail: `Источник «${event.title}» содержит инструкции для модели; проигнорированы`,
        sourceIds: [event.id],
      })
    }
  }
  const latestReport = p.reports[0]
  if (!latestReport) {
    missing.push('Получить свежую финансовую отчётность')
  } else if (new Date(p.asOf).getTime() - new Date(latestReport.publishedAt).getTime() > 150 * 86_400_000) {
    missing.push(`Отчётность устарела (${latestReport.period})`)
  }
  const critical = findings.filter(f => f.severity === 'critical').length
  const warnings = findings.filter(f => f.severity === 'warning').length
  let verdict: CriticOutput['verdict'] = 'supported'
  if (!latestReport && claims.direction === 'long') {
    verdict = 'insufficient_evidence'
  } else if (critical > 0 || warnings >= 2) {
    verdict = 'disputed'
  }
  return {
    verdict,
    verdictTarget: 'decision',
    decisionVerdict: verdict,
    forecastVerdict: claims.priceForecast ? 'insufficient_evidence' : 'not_applicable',
    coverageGaps: p.coverageGaps ?? [],
    summary: verdict === 'supported'
      ? 'Рекомендация согласуется с предоставленными метриками; это не подтверждение движения цены.'
      : verdict === 'disputed'
        ? `Тезис оспорен: ${findings.filter(f => f.severity !== 'info').map(f => f.topic.toLowerCase()).join(', ')}.`
        : 'Недостаточно данных для вывода: нет отчётности.',
    findings,
    missingChecks: missing,
  }
}

function review(p: OutcomePacket): OutcomeReviewOutput {
  const e = p.evaluation as {
    netReturn?: number
    excessReturn?: number | null
    exitReason?: string
    maxDrawdown?: number
    isCounterfactual?: boolean
  }
  const net = e.netReturn ?? 0
  const good = net > 0
  const suggestions: OutcomeReviewOutput['ruleSuggestions'] = []
  if (e.exitReason === 'stop_loss' && (e.maxDrawdown ?? 0) > -0.04) {
    suggestions.push({
      parameter: 'stopAtr',
      direction: 'increase',
      rationale: 'Стоп сработал при небольшой просадке — возможно, он слишком близко к шуму',
    })
  }
  if (e.exitReason === 'time_exit' && net > 0) {
    suggestions.push({
      parameter: 'horizonDays',
      direction: 'increase',
      rationale: 'Цель не достигнута, но движение шло в ожидаемую сторону',
    })
  }
  return {
    summary: `${p.hypothesis.symbol} (${p.hypothesis.strategy}): ${good ? 'прибыльный' : 'убыточный'} исход ${pct(net)} после издержек, относительно индекса ${pct(e.excessReturn)}. Выход: ${e.exitReason}.${e.isCounterfactual ? ' Результат контрфактический — идея была отклонена.' : ''}`,
    lessons: [good ? 'Сигнал сработал в рамках горизонта' : 'Условия опровержения сработали — риск был ограничен стопом', 'Один исход не является статистически значимым'],
    forecastVsActual: `Прогноз: «${p.hypothesis.thesis.slice(0, 300)}». Факт: ${pct(net)} нетто, вердикт критика ${p.hypothesis.criticVerdict ?? '—'}.`,
    processIssues: p.hypothesis.criticVerdict === 'disputed' && good ? ['Критик оспорил идею, но она сработала — проверить калибровку критика'] : [],
    ruleSuggestions: suggestions,
  }
}

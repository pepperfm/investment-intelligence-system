import type { ApiResponse } from './api'
import { STATUS_LABELS, STRATEGY_LABELS, VERDICT_LABELS } from './format'

export type HypothesisExport = ApiResponse<'/api/hypotheses/:id'>
export type HypothesisExportFormat = 'md' | 'txt'

/** A readable copy of stored results; never generates a new analysis or changes a decision. */
export function exportHypotheses(hypotheses: HypothesisExport[], format: HypothesisExportFormat = 'md') {
  const heading = (level: number, text: string) => format === 'md' ? `${'#'.repeat(level)} ${text}` : text
  const list = (items: string[]) => items.length ? items.map(item => `- ${item}`).join('\n') : 'Не указано.'
  const moscowTime = (value: string) => new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
  const evidence = (items: HypothesisExport['supportingEvidence']) => list(items.map(item => `${item.claim}${item.sourceIds.length ? ` [${item.sourceIds.join(', ')}]` : ''}`))
  return hypotheses.map((h) => {
    const critic = h.reviews.find(review => review.role === 'critic')
    const modern = h.semanticVersion === 'decision_v2'
    let decisionVerdictLabel = 'Проверка не завершена'
    if (modern && h.direction === 'no_trade' && h.criticVerdict === 'supported') {
      decisionVerdictLabel = 'Решение не покупать обосновано'
    } else if (h.criticVerdict) {
      decisionVerdictLabel = VERDICT_LABELS[h.criticVerdict] ?? h.criticVerdict
    }
    const section = (title: string, body: string) => `${heading(3, title)}\n\n${body}`
    const parts = [
      heading(2, `${h.instrument.ticker} · ${STRATEGY_LABELS[h.strategyId] ?? h.strategyId}`),
      `${h.instrument.name}\nID: ${h.id}\nСтатус: ${STATUS_LABELS[h.status] ?? h.status}\nНаправление: ${h.direction === 'long' ? 'Long' : 'Не покупать'}\nДанные на: ${moscowTime(h.evidenceTimestamp)} МСК (${h.evidenceTimestamp})\nСоздана: ${moscowTime(h.createdAt)} МСК (${h.createdAt})\nГоризонт: ${h.horizonDays} ${h.marketScenario?.horizonUnit === 'confirmed_sessions' ? 'подтверждённых сессий (реконструкция)' : 'торг. дн.'}\nПравила: ${h.strategyVersion ? `v${h.strategyVersion.version}` : h.strategyVersionId}\nАналитик: ${h.analystProvider}\n${modern ? 'Качество обоснования (не вероятность прибыли)' : 'Исходная уверенность · legacy'}: ${((h.decisionConfidence ?? h.confidence) * 100).toFixed(0)}%`,
      section(modern ? 'Обоснование решения' : 'Исходный тезис · legacy', h.decisionThesis ?? h.thesis),
      section(modern ? 'Что говорит в пользу решения' : 'Исходные аргументы за · legacy', evidence(h.supportingEvidence)),
      section(modern ? 'Что против решения' : 'Исходные аргументы против · legacy', evidence(h.counterEvidence)),
      section('Предположения', list(h.assumptions)),
      section('Условия отмены гипотезы', list(h.invalidationConditions)),
      section('Риски', list(h.riskNotes)),
      section('Альтернативы', list(h.alternatives)),
      section('Сценарий условной покупки', `Уровни рассчитаны кодом и не являются рекомендацией открыть позицию.\nТип входа: ${h.entryScenario.type === 'limit' ? 'Лимитный' : 'Следующее торговое открытие'}\nВход: ${h.entryScenario.price} ${h.instrument.currency}\nОкно входа: ${h.entryScenario.validDays} торг. дн.\nСтоп: ${h.exitScenario.stopLoss}\nЦель: ${h.exitScenario.takeProfit}\nВыход по времени: ${h.exitScenario.timeExitDays} торг. дн.\n${h.entryScenario.note}\n${h.exitScenario.note}`),
      section('Независимый критик', `${modern ? 'Вердикт по решению' : 'Исходный вердикт · legacy'}: ${decisionVerdictLabel}${critic ? `\nПровайдер: ${critic.provider}\n${critic.summary}\n\nЗамечания:\n${list(critic.findings.map(finding => `[${finding.severity}] ${finding.topic}: ${finding.detail}${finding.sourceIds.length ? ` [${finding.sourceIds.join(', ')}]` : ''}`))}\n\nНедостающие проверки:\n${list(critic.missingChecks)}` : ''}`),
      section('Кодовая валидация', `${h.validation.ok ? 'Пройдена' : 'Не пройдена'}${h.validation.issues.length ? `\n${list(h.validation.issues)}` : ''}`),
      section('Источники', list(h.sources.map(source => `[${source.id}] ${source.title}\n  ${source.url ?? 'Внутренний расчёт IIS'}\n  Дата рыночных данных: ${source.asOf}\n  Доступность: ${source.availableAt ?? 'историческое время не зафиксировано'}${source.observedAt ? `; реально получено: ${source.observedAt}` : ''}${source.verification ? `; проверка: ${source.verification}` : ''}`))),
    ]
    if (modern) {
      parts.push(section('Рекомендация', (h.recommendation ?? h.direction) === 'long' ? 'Рассмотреть покупку' : 'Не покупать'))
      parts.push(section('Типы оснований решения', list(h.decisionBasis ?? [])))
      parts.push(section('Отдельный ценовой прогноз', h.priceForecast
        ? `${h.priceForecast.criterion}\nОкно: ${h.priceForecast.windowTradingDays} торг. дн.\n${h.priceForecast.rationale}\nИсточники: ${h.priceForecast.sourceIds.join(', ')}\nВердикт по прогнозу: ${h.forecastVerdict ?? 'Не проверен'}`
        : 'Не заявлен; вердикт по решению не подтверждает движение цены.'))
    } else {
      parts.push('Запись legacy: решение и ценовой прогноз не разделялись. Исходный смысл уверенности и вердикта не переинтерпретирован.')
    }
    if (h.coverageGaps?.length) {
      parts.push(section('Непокрытые проверки (не цитаты)', list(h.coverageGaps.map(gap => `${gap.sourceKey} · ${gap.status} · ${gap.asOf}: ${gap.reason}. Влияние: ${gap.impact}`))))
    }
    if (h.audit) {
      parts.push(section('Происхождение и воспроизводимость', `Провайдер данных: ${h.audit.marketProvider ?? 'Не зафиксирован'}\nВерсия правил ID: ${h.strategyVersionId}\nКалендарь: ${h.audit.calendarVersion ?? 'legacy'}\nНормализация: ${h.audit.normalizationVersion ?? 'legacy'}\nHash правил: ${h.marketScenario?.rulesHash ?? 'Не зафиксирован'}\nДоступно на дату анализа: ${h.audit.sourceAvailability.available.join(', ') || 'нет'}\nПолучено позже: ${h.audit.sourceAvailability.observedLater.join(', ') || 'нет'}\nНедоступно: ${h.audit.sourceAvailability.unavailable.join(', ') || 'нет'}`))
    }
    if (h.userComment) {
      parts.push(section('Комментарий пользователя', h.userComment))
    }
    if (h.snapshot) {
      parts.push(`Snapshot: ${h.snapshot.id}\nSHA256: ${h.snapshot.sha256}`)
    }
    return parts.join('\n\n')
  }).join('\n\n---\n\n') + '\n'
}

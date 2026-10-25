<script setup lang="ts">
const props = defineProps<{ h: ApiResponse<'/api/hypotheses/:id'> }>()
const modern = computed(() => props.h.semanticVersion === 'decision_v2')
const recommendation = computed(() => props.h.recommendation ?? props.h.direction)
const scenario = computed(() => props.h.marketScenario)
const moscowTime = (value: string) => new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  dateStyle: 'short',
  timeStyle: 'short',
}).format(new Date(value))
const basisLabels: Record<string, string> = {
  negative_historical_edge: 'Отрицательное историческое преимущество',
  missing_material_evidence: 'Не хватает существенных свидетельств',
  risk_limit: 'Ограничение риска',
  contradictory_signals: 'Противоречивые сигналы',
  positive_evidence: 'Положительные свидетельства',
  other: 'Другая причина',
}
const forecastLabels: Record<string, string> = {
  take_profit_before_stop: 'Цель раньше стопа',
  stop_before_take_profit: 'Стоп раньше цели',
  positive_net_return: 'Положительная доходность после издержек',
  non_positive_net_return: 'Неположительная доходность после издержек',
}
const gapLabels: Record<string, string> = {
  not_covered: 'Нет покрытия',
  unavailable: 'Недоступно',
  stale: 'Устарело',
  not_yet_observed: 'Ещё не получено на дату',
  not_applicable: 'Неприменимо',
}
</script>

<template>
  <section class="space-y-4 rounded-lg border border-default p-4 text-sm">
    <UAlert
      v-if="!modern"
      color="neutral"
      variant="subtle"
      title="Историческая запись · legacy"
      description="Исходные тезис, уверенность и вердикт сохранены. Решение и ценовой прогноз в этой версии не разделялись; их смысл не переинтерпретирован."
    />
    <p v-if="!modern" class="whitespace-pre-line">
      {{ h.thesis }}
    </p>
    <template v-if="modern">
      <div>
        <h3 class="section-label">
          Рекомендация
        </h3>
        <p class="mt-1 font-semibold">
          {{ recommendation === 'long' ? 'Рассмотреть покупку' : 'Не покупать' }}
        </p>
      </div>
      <div>
        <h3 class="section-label">
          Обоснование решения
        </h3>
        <p class="mt-1 whitespace-pre-line">
          {{ h.decisionThesis }}
        </p>
        <ul v-if="h.decisionBasis?.length" class="mt-2 list-inside list-disc text-muted">
          <li v-for="basis in h.decisionBasis" :key="basis">
            {{ basisLabels[basis] ?? basis }}
          </li>
        </ul>
      </div>
      <p class="text-muted">
        Качество обоснования: {{ fmtPct(h.decisionConfidence, 0) }}.
        Субъективная оценка полноты свидетельств, не вероятность прибыли.
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <span>Вердикт по решению:</span>
        <VerdictBadge
          :verdict="h.criticVerdict"
          :direction="recommendation"
          :verdict-target="h.verdictTarget"
        />
      </div>
      <div v-if="h.priceForecast" class="space-y-2 rounded bg-elevated/50 p-3">
        <h3 class="section-label">
          Отдельный ценовой прогноз
        </h3>
        <p>{{ forecastLabels[h.priceForecast.criterion] ?? h.priceForecast.criterion }} · {{ h.priceForecast.windowTradingDays }} {{ scenario?.horizonUnit === 'confirmed_sessions' ? 'подтверждённых сессий' : 'торг. дн.' }}</p>
        <p>{{ h.priceForecast.rationale }}</p>
        <p class="text-xs text-muted">
          Источники: {{ h.priceForecast.sourceIds.join(', ') }}
        </p>
        <p>Вердикт по прогнозу: {{ h.forecastVerdict === 'not_applicable' ? 'Не применимо' : VERDICT_LABELS[h.forecastVerdict ?? ''] ?? 'Не проверен' }}</p>
      </div>
      <p v-else class="text-muted">
        Отдельный прогноз движения цены не заявлен.
      </p>
    </template>
    <div v-if="scenario" class="space-y-2 rounded bg-elevated/50 p-3">
      <h3 class="section-label">
        Сценарий условной покупки
      </h3>
      <p class="text-muted">
        Уровни рассчитаны кодом. Сценарий существует независимо от рекомендации и не означает разрешение купить.
      </p>
      <LevelsBar
        :entry="scenario.entry.price"
        :stop="scenario.exit.stopLoss"
        :target="scenario.exit.takeProfit"
      />
      <UAlert
        v-if="scenario.horizonUnit === 'confirmed_sessions'"
        color="warning"
        title="Физические сессии · историческая реконструкция"
        description="Новый набор входных данных, несопоставимый с прежними логическими днями. Историческая публикация и корректировки неизвестны. Будущий срок условный, paper-исполнение этим рядом не разрешено."
        class="mb-2"
      />
      <p>Вход: {{ scenario.entry.type === 'market_next_open' ? 'следующее торговое открытие' : 'лимитный' }} · окно {{ scenario.entry.validDays }} {{ scenario.horizonUnit === 'confirmed_sessions' ? 'сессий' : 'торг. дн.' }} · горизонт {{ scenario.horizonTradingDays }} {{ scenario?.horizonUnit === 'confirmed_sessions' ? 'подтверждённых сессий' : 'торг. дн.' }}</p>
    </div>
    <div v-if="h.coverageGaps?.length" class="space-y-2">
      <h3 class="section-label">
        Непокрытые проверки
      </h3>
      <div
        v-for="(gap, index) in h.coverageGaps"
        :key="`${gap.sourceKey}-${index}`"
        class="border-l-2 border-warning pl-3"
      >
        <p>{{ gap.sourceKey }} · {{ gapLabels[gap.status] }} · {{ moscowTime(gap.asOf) }} МСК</p>
        <p>{{ gap.reason }}</p>
        <p class="text-muted">
          Влияние: {{ gap.impact }}
        </p>
      </div>
    </div>
    <UAlert
      v-if="h.audit?.dependencies?.benchmarkUnavailableReason"
      color="warning"
      :title="h.audit.dependencies.benchmarkNeed === 'required_for_signal' ? 'Обязательный IMOEX недоступен' : 'Необязательный IMOEX недоступен'"
      :description="`Качество акции: ${h.audit.dependencies.instrumentQuality}. Индексные momentum/SMA и сравнительная доходность не рассчитаны: ${h.audit.dependencies.benchmarkUnavailableReason}`"
    />
    <dl class="grid gap-2 text-xs text-muted sm:grid-cols-2">
      <div><dt>Данные на · МСК</dt><dd>{{ moscowTime(h.evidenceTimestamp) }}</dd></div>
      <div><dt>Создана · МСК</dt><dd>{{ moscowTime(h.createdAt) }}</dd></div>
      <div>
        <dt>Версия правил</dt><dd class="break-all">
          v{{ h.strategyVersion?.version ?? '—' }} · {{ h.strategyVersionId }}
        </dd>
      </div>
      <div><dt>Провайдер данных</dt><dd>{{ h.audit?.marketProvider ?? 'Не зафиксирован' }}</dd></div>
      <div>
        <dt>Календарь / нормализация</dt><dd class="break-all">
          {{ h.audit?.calendarVersion ?? 'legacy / неизвестно' }} / {{ h.audit?.normalizationVersion ?? 'неизвестно' }}
        </dd>
      </div>
      <div v-if="scenario">
        <dt>Hash правил</dt><dd class="break-all">
          {{ scenario.rulesHash }}
        </dd>
      </div>
    </dl>
    <p class="text-xs text-muted">
      Версии правил в базах mock и Finam независимы. Номер v1 сам по себе не означает ошибку.
    </p>
    <div v-if="h.audit?.sourceAvailability" class="space-y-1 text-xs">
      <p>Доступно на дату анализа: {{ h.audit.sourceAvailability.available.join(', ') || 'нет' }}</p>
      <p>Получено системой позже: {{ h.audit.sourceAvailability.observedLater.join(', ') || 'нет' }}</p>
      <p>Недоступно: {{ h.audit.sourceAvailability.unavailable.join(', ') || 'нет' }}</p>
    </div>
    <UAlert
      v-if="h.audit?.dataQuality?.status === 'data_quality_blocked'"
      color="warning"
      variant="subtle"
      title="Качество данных блокирует вывод"
      :description="h.audit.dataQuality.issues.join('; ')"
    />
    <UButton
      v-if="h.snapshot"
      :to="`/api/hypotheses/${h.id}/snapshot`"
      target="_blank"
      variant="link"
      size="xs"
      icon="i-lucide-file-json"
    >
      Открыть исходный snapshot
    </UButton>
    <UButton
      v-if="h.audit?.trackRecordAuditId"
      :to="`/api/hypotheses/${h.id}/audit`"
      target="_blank"
      variant="link"
      size="xs"
    >
      Журнал бэктеста: исходные ряды, hashes и сделки
    </UButton>
  </section>
</template>

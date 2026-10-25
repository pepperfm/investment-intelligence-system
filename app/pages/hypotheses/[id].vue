<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const route = useRoute()
const id = computed(() => String(route.params.id))
const { data: h, refresh } = await useFetch<ApiResponse<'/api/hypotheses/:id'>>(() => `/api/hypotheses/${id.value}`)
const { data: instrumentData } = await useFetch<ApiResponse<'/api/instruments/:id'>>(() => `/api/instruments/${h.value?.instrumentId}`, {
  immediate: Boolean(h.value),
  watch: false,
})
const decision = useAction()
const critic = useAction()
const comment = ref('')
const orderOpen = ref(false)
const tab = ref('evidence')

const critique = computed(() => h.value?.reviews.find(r => r.role === 'critic'))
const outcome = computed(() => h.value?.reviews.find(r => r.role === 'outcome'))
const canDecide = computed(() => ['ready_for_user', 'needs_review', 'watching'].includes(h.value?.status ?? ''))
const canApprove = computed(() => h.value
  && ['ready_for_user', 'watching'].includes(h.value.status)
  && h.value.criticVerdict === 'supported' && h.value.validation.ok)
const canClose = computed(() => ['user_approved', 'user_rejected', 'watching', 'ready_for_user', 'needs_review'].includes(h.value?.status ?? ''))
const lastClose = computed(() => instrumentData.value?.candles.at(-1)?.close ?? null)
const rr = computed(() => {
  if (!h.value) {
    return null
  }
  const risk = h.value.entryScenario.price - h.value.exitScenario.stopLoss
  return risk > 0 ? (h.value.exitScenario.takeProfit - h.value.entryScenario.price) / risk : null
})
const levels = computed(() => h.value && h.value.direction === 'long'
  ? [
      {
        label: 'Цель',
        value: h.value.exitScenario.takeProfit,
        color: 'success' as const,
      },
      {
        label: 'Вход',
        value: h.value.entryScenario.price,
        color: 'info' as const,
      },
      {
        label: 'Стоп',
        value: h.value.exitScenario.stopLoss,
        color: 'error' as const,
      },
    ]
  : [])

const SEVERITY = {
  critical: {
    icon: 'i-lucide-octagon-alert',
    color: 'error',
    label: 'Критично',
  },
  warning: {
    icon: 'i-lucide-triangle-alert',
    color: 'warning',
    label: 'Предупреждение',
  },
  info: {
    icon: 'i-lucide-info',
    color: 'neutral',
    label: 'Заметка',
  },
} as const
const SEVERITY_CLASS = {
  critical: 'text-error',
  warning: 'text-warning',
  info: 'text-muted',
} as const
const findings = computed(() => {
  const order = {
    critical: 0,
    warning: 1,
    info: 2,
  }
  return [...(critique.value?.findings ?? [])].sort((a, b) => order[a.severity] - order[b.severity])
})
const severityCount = computed(() => ({
  critical: findings.value.filter(f => f.severity === 'critical').length,
  warning: findings.value.filter(f => f.severity === 'warning').length,
}))

const EVENT_LABELS: Record<string, {
  title: string
  icon: string
}> = {
  created: {
    title: 'Гипотеза сформулирована',
    icon: 'i-lucide-sparkles',
  },
  critic_completed: {
    title: 'Независимый критик',
    icon: 'i-lucide-shield-check',
  },
  critic_failed: {
    title: 'Критик не отработал',
    icon: 'i-lucide-shield-alert',
  },
  user_approve: {
    title: 'Одобрена',
    icon: 'i-lucide-check',
  },
  user_reject: {
    title: 'Отклонена',
    icon: 'i-lucide-x',
  },
  user_watch: {
    title: 'Наблюдение',
    icon: 'i-lucide-eye',
  },
  user_defer: {
    title: 'Отложена',
    icon: 'i-lucide-clock',
  },
  user_close: {
    title: 'Закрыта',
    icon: 'i-lucide-archive',
  },
  evaluated: {
    title: 'Оценён исход',
    icon: 'i-lucide-target',
  },
  paper_fill: {
    title: 'Исполнена paper-заявка',
    icon: 'i-lucide-receipt',
  },
}
const timeline = computed(() => (h.value?.events ?? []).map(e => ({
  date: fmtDate(e.createdAt, true),
  title: EVENT_LABELS[e.type]?.title ?? e.type,
  icon: EVENT_LABELS[e.type]?.icon ?? 'i-lucide-dot',
  description: [e.toStatus && e.toStatus !== e.fromStatus ? `→ ${STATUS_LABELS[e.toStatus] ?? e.toStatus}` : '', e.actor === 'user' ? 'вы' : e.actor === 'agent' ? 'агент' : 'система', e.comment ?? ''].filter(Boolean).join(' · '),
})))
const sourceGroups = computed(() => {
  const groups: Record<string, typeof h.value extends infer T ? T extends { sources: infer S } ? S : never : never> = {}
  for (const s of h.value?.sources ?? []) {
    (groups[s.kind] ??= []).push(s)
  }
  return groups
})
const SOURCE_KIND_LABELS: Record<string, string> = {
  candles: 'Котировки',
  metrics: 'Расчёты кодом',
  backtest: 'Статистика стратегии',
  event: 'События',
  report: 'Отчётность',
  memory: 'Память',
  macro: 'Макро ЦБ',
  regulatory: 'События регулятора',
}

const tabs = computed(() => [
  {
    label: 'Аргументы',
    value: 'evidence',
    icon: 'i-lucide-scale',
  },
  {
    label: 'Критик',
    value: 'critic',
    icon: 'i-lucide-shield',
    badge: severityCount.value.critical ? String(severityCount.value.critical) : undefined,
  },
  {
    label: 'Сценарий',
    value: 'scenario',
    icon: 'i-lucide-route',
  },
  {
    label: 'Источники',
    value: 'sources',
    icon: 'i-lucide-library',
    badge: String(h.value?.sources.length ?? 0),
  },
  {
    label: 'История',
    value: 'history',
    icon: 'i-lucide-history',
  },
])

async function decide(action: 'approve' | 'reject' | 'defer' | 'watch' | 'close') {
  await decision.run(() => $fetch<ApiResponse<'/api/hypotheses/:id/decision', 'post'>>(`/api/hypotheses/${id.value}/decision`, {
    method: 'POST',
    body: {
      action,
      comment: comment.value || undefined,
    },
  }), 'Решение сохранено. Заявка не создавалась.')
  comment.value = ''
  await refresh()
}

async function rerunCritic() {
  await critic.run(() => $fetch<ApiResponse<'/api/hypotheses/:id/critic', 'post'>>(`/api/hypotheses/${id.value}/critic`, { method: 'POST' }), r => `Критик завершён: ${STATUS_LABELS[r.status]}`)
  await refresh()
}

const moreActions = computed<DropdownMenuItem[][]>(() => [[
  {
    label: 'Наблюдать',
    icon: 'i-lucide-eye',
    disabled: !canDecide.value,
    onSelect: () => decide('watch'),
  },
  {
    label: 'Отложить',
    icon: 'i-lucide-clock',
    disabled: !canDecide.value,
    onSelect: () => decide('defer'),
  },
  {
    label: 'Закрыть',
    icon: 'i-lucide-archive',
    disabled: !canClose.value,
    onSelect: () => decide('close'),
  },
], [
  {
    label: 'Повторить проверку критиком',
    icon: 'i-lucide-rotate-ccw',
    disabled: h.value?.semanticVersion === 'legacy' || !['needs_review', 'awaiting_critic', 'watching'].includes(h.value?.status ?? ''),
    onSelect: rerunCritic,
  },
  {
    label: 'Снапшот данных (JSON)',
    icon: 'i-lucide-file-json',
    onSelect: () => {
      window.open(`/api/hypotheses/${id.value}/snapshot`, '_blank')
    },
  },
]])
useHead({ title: computed(() => `${h.value?.instrument.ticker ?? 'Гипотеза'} · IIS`) })
</script>

<template>
  <UDashboardPanel id="hypothesis">
    <template #header>
      <PageNavbar :title="h ? `${h.instrument.ticker} · ${STRATEGY_LABELS[h.strategyId]} v${h.strategyVersion?.version ?? '?'}` : 'Гипотеза'" back="/hypotheses">
        <template v-if="h" #title-extra>
          <StatusBadge :status="h.status" class="hidden sm:inline-flex" />
          <VerdictBadge
            :verdict="h.criticVerdict"
            :direction="h.direction"
            :verdict-target="h.verdictTarget"
            class="hidden sm:inline-flex"
          />
        </template>
        <template v-if="h" #right>
          <UButton
            icon="i-lucide-receipt"
            color="neutral"
            variant="outline"
            :disabled="h.status !== 'user_approved' || h.direction !== 'long'"
            class="hidden md:inline-flex"
            @click="orderOpen = true"
          >
            Paper-заявка
          </UButton>
        </template>
      </PageNavbar>
    </template>
    <template #body>
      <template v-if="h">
        <UAlert
          v-if="h.status === 'awaiting_critic'"
          color="warning"
          variant="subtle"
          icon="i-lucide-shield-alert"
          title="Независимая проверка не завершена"
          description="Пока критик не отработал успешно, гипотеза не считается проверенной рекомендацией."
          :actions="[{ label: 'Запустить критика', loading: critic.pending.value, onClick: rerunCritic }]"
        />
        <UAlert
          v-else-if="h.status === 'needs_review'"
          color="warning"
          variant="subtle"
          icon="i-lucide-message-square-warning"
          title="Нужен разбор"
          :description="!h.validation.ok ? `Кодовая проверка: ${h.validation.issues.join(' · ')}` : 'Критик оспорил гипотезу или данных недостаточно — одобрение недоступно. Можно отклонить, наблюдать или повторить проверку.'"
        />

        <div class="grid gap-4 xl:grid-cols-[1fr_20rem]">
          <div class="min-w-0 space-y-4">
            <UCard>
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <h2 class="text-lg font-semibold text-highlighted">
                      {{ h.instrument.name }}
                    </h2>
                    <NuxtLink :to="`/instruments/${h.instrument.id}`" class="num text-xs text-muted hover:text-primary">
                      {{ h.instrument.symbol }}
                    </NuxtLink>
                    <UBadge :color="h.direction === 'long' ? 'success' : 'neutral'" :icon="h.direction === 'long' ? 'i-lucide-trending-up' : 'i-lucide-ban'">
                      {{ h.direction === 'long' ? 'Long' : 'Не покупать' }}
                    </UBadge>
                  </div>
                  <p class="mt-1 text-xs text-muted">
                    Данные на {{ fmtDate(h.evidenceTimestamp, true) }} · {{ h.semanticVersion === 'legacy' ? 'Legacy: календарная дата проверки не подтверждена' : `проверка исхода ${fmtDate(h.checkAt)}` }} · {{ h.analystProvider }}
                  </p>
                </div>
                <dl class="flex gap-5 text-right">
                  <div>
                    <dt class="text-[11px] text-muted">
                      Горизонт
                    </dt><dd class="num text-sm font-semibold text-highlighted">
                      {{ h.horizonDays }} дн.
                    </dd>
                  </div>
                  <div>
                    <dt class="text-[11px] text-muted">
                      R/R
                    </dt><dd class="num text-sm font-semibold text-highlighted">
                      {{ rr ? rr.toFixed(2) : '—' }}
                    </dd>
                  </div>
                  <UTooltip text="Субъективная оценка качества свидетельств, не вероятность прибыли. Legacy: исходная уверенность без переинтерпретации.">
                    <div>
                      <dt class="text-[11px] text-muted">
                        {{ h.semanticVersion === 'legacy' ? 'Уверенность · legacy' : 'Качество обоснования' }}
                      </dt><dd class="num text-sm font-semibold text-highlighted">
                        {{ fmtPct(h.confidence, 0) }}
                      </dd>
                    </div>
                  </UTooltip>
                </dl>
              </div>
              <HypothesisSemantics :h="h" class="mt-4" />
              <LevelsBar
                v-if="h.direction === 'long'"
                class="mt-5"
                :entry="h.entryScenario.price"
                :stop="h.exitScenario.stopLoss"
                :target="h.exitScenario.takeProfit"
                :last="lastClose"
              />
              <USeparator class="my-5" />
              <p class="mb-2 text-xs text-muted">
                График загруженной истории может включать цены после asOf. Они не входят в исходный пакет анализа; будущие цены используются только для отдельной оценки исхода.
              </p>
              <PriceChart
                :candles="instrumentData?.candles ?? []"
                :indicators="instrumentData?.dataQuality.status === 'verified'"
                :ranges="instrumentData?.dataQuality.status === 'verified'"
                :levels="levels"
                :markers="[{ ts: h.evidenceTimestamp, label: 'идея' }]"
                :height="240"
                :default-range="63"
              />
            </UCard>

            <UCard :ui="{ header: 'p-0 sm:px-2 border-b border-default', body: 'p-4 sm:p-5' }">
              <template #header>
                <UTabs
                  v-model="tab"
                  :items="tabs"
                  :content="false"
                  variant="link"
                  size="sm"
                  class="-mb-px"
                />
              </template>

              <div v-if="tab === 'evidence'" class="grid gap-6 md:grid-cols-2">
                <div>
                  <p class="section-label mb-3 flex items-center gap-1.5">
                    <span class="size-1.5 rounded-full bg-success" /> {{ h.semanticVersion === 'legacy' ? 'Исходные аргументы за · legacy' : 'В пользу решения' }} · {{ h.supportingEvidence.length }}
                  </p>
                  <EvidenceList
                    :items="h.supportingEvidence"
                    :sources="h.sources"
                    tone="support"
                  />
                </div>
                <div>
                  <p class="section-label mb-3 flex items-center gap-1.5">
                    <span class="size-1.5 rounded-full bg-error" /> {{ h.semanticVersion === 'legacy' ? 'Исходные аргументы против · legacy' : 'Против решения' }} · {{ h.counterEvidence.length }}
                  </p>
                  <EvidenceList
                    :items="h.counterEvidence"
                    :sources="h.sources"
                    tone="counter"
                  />
                </div>
              </div>

              <div v-else-if="tab === 'critic'" class="space-y-4">
                <UAlert
                  v-if="critique?.validationIssues?.length"
                  color="error"
                  title="Ответ критика не прошёл проверку источников"
                  :description="critique.validationIssues.join('; ')"
                />
                <template v-if="critique">
                  <div class="flex flex-wrap items-center gap-2">
                    <VerdictBadge :verdict="critique.verdict" size="md" />
                    <span class="text-xs text-muted">{{ critique.provider }} · {{ fmtDate(critique.createdAt, true) }} · {{ ((critique.durationMs ?? 0) / 1000).toFixed(0) }} с</span>
                    <span class="ml-auto flex gap-3 text-xs">
                      <span v-if="severityCount.critical" class="text-error">{{ severityCount.critical }} критично</span>
                      <span v-if="severityCount.warning" class="text-warning">{{ severityCount.warning }} предупр.</span>
                    </span>
                  </div>
                  <p class="text-sm leading-relaxed">
                    {{ critique.summary }}
                  </p>
                  <UAccordion
                    type="multiple"
                    :default-value="findings.map((f, i) => f.severity === 'critical' ? String(i) : '').filter(Boolean)"
                    :items="findings.map((f, i) => ({ label: f.topic, value: String(i), icon: SEVERITY[f.severity].icon, slot: 'finding' as const, finding: f }))"
                    :ui="{ trigger: 'text-sm py-2.5', leadingIcon: 'size-4' }"
                  >
                    <template #leading="{ item }">
                      <UIcon
                        :name="item.icon"
                        class="size-4 shrink-0"
                        :class="SEVERITY_CLASS[item.finding.severity]"
                      />
                    </template>
                    <template #finding-body="{ item }">
                      <p class="text-sm text-toned">
                        {{ item.finding.detail }}
                      </p>
                      <div v-if="item.finding.sourceIds.length" class="mt-2 flex flex-wrap gap-1">
                        <SourceChip
                          v-for="sid in item.finding.sourceIds"
                          :id="sid"
                          :key="sid"
                          :source="h.sources.find(s => s.id === sid)"
                        />
                      </div>
                    </template>
                  </UAccordion>
                  <div v-if="critique.missingChecks.length" class="rounded-lg bg-elevated/50 p-3">
                    <p class="section-label mb-2">
                      Чего не хватает для вывода
                    </p>
                    <ul class="space-y-1.5 text-sm">
                      <li
                        v-for="m in critique.missingChecks"
                        :key="m"
                        class="flex gap-2"
                      >
                        <UIcon name="i-lucide-square-dashed" class="mt-0.5 size-4 shrink-0 text-dimmed" />{{ m }}
                      </li>
                    </ul>
                  </div>
                </template>
                <UEmpty
                  v-else
                  icon="i-lucide-shield-question"
                  title="Критик ещё не отработал"
                  size="sm"
                  variant="naked"
                />
              </div>

              <div v-else-if="tab === 'scenario'" class="grid gap-6 md:grid-cols-3">
                <div>
                  <p class="section-label mb-2">
                    Допущения
                  </p>
                  <ul class="space-y-1.5 text-sm">
                    <li
                      v-for="a in h.assumptions"
                      :key="a"
                      class="flex gap-2"
                    >
                      <UIcon name="i-lucide-dot" class="size-4 shrink-0 text-dimmed" />{{ a }}
                    </li>
                  </ul>
                </div>
                <div>
                  <p class="section-label mb-2">
                    Опровергается, если
                  </p>
                  <ul class="space-y-1.5 text-sm">
                    <li
                      v-for="a in h.invalidationConditions"
                      :key="a"
                      class="flex gap-2"
                    >
                      <UIcon name="i-lucide-circle-x" class="mt-0.5 size-3.5 shrink-0 text-error" />{{ a }}
                    </li>
                  </ul>
                </div>
                <div>
                  <p class="section-label mb-2">
                    Риски и альтернативы
                  </p>
                  <ul class="space-y-1.5 text-sm">
                    <li
                      v-for="a in h.riskNotes"
                      :key="a"
                      class="flex gap-2"
                    >
                      <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-3.5 shrink-0 text-warning" />{{ a }}
                    </li>
                  </ul>
                  <div class="mt-3 flex flex-wrap gap-1">
                    <UBadge
                      v-for="a in h.alternatives"
                      :key="a"
                      color="neutral"
                      variant="outline"
                      size="sm"
                    >
                      {{ a }}
                    </UBadge>
                  </div>
                </div>
                <div class="text-xs text-muted md:col-span-3">
                  {{ h.entryScenario.note }} {{ h.exitScenario.note }}
                </div>
              </div>

              <div v-else-if="tab === 'sources'" class="space-y-4">
                <UAlert
                  v-if="h.snapshot?.evidenceCoverage?.missing.length"
                  color="warning"
                  title="Покрытие данных на момент анализа"
                  :description="h.snapshot.evidenceCoverage.missing.join('. ')"
                />
                <div v-for="(items, kind) in sourceGroups" :key="kind">
                  <p class="section-label mb-2">
                    {{ SOURCE_KIND_LABELS[kind] ?? kind }} · {{ items.length }}
                  </p>
                  <ul class="divide-y divide-default rounded-lg ring ring-default">
                    <li
                      v-for="s in items"
                      :key="s.id"
                      class="flex items-center gap-3 px-3 py-2 text-sm"
                    >
                      <span class="num w-24 shrink-0 text-xs text-muted">{{ s.id }}</span>
                      <span class="min-w-0 flex-1 truncate">{{ s.title }}</span>
                      <span class="text-xs text-dimmed">{{ fmtDate(s.asOf) }}</span>
                    </li>
                  </ul>
                </div>
                <p v-if="h.snapshot" class="flex items-center gap-2 text-xs text-muted">
                  <UIcon name="i-lucide-lock" class="size-3.5" />Неизменяемый снапшот
                  <a
                    :href="`/api/hypotheses/${h.id}/snapshot`"
                    target="_blank"
                    class="num hover:text-primary"
                  >sha256 {{ h.snapshot.sha256.slice(0, 16) }}…</a>
                </p>
              </div>

              <div v-else class="space-y-4">
                <UTimeline
                  :items="timeline"
                  size="xs"
                  :default-value="timeline.length - 1"
                />
              </div>
            </UCard>
          </div>

          <div class="space-y-4 xl:sticky xl:top-0 xl:self-start">
            <UCard>
              <p class="section-label mb-3">
                Решение по гипотезе
              </p>
              <UTextarea
                v-model="comment"
                placeholder="Комментарий (сохранится в истории)"
                :rows="2"
                autoresize
                class="w-full"
              />
              <div class="mt-3 grid grid-cols-2 gap-2">
                <UButton
                  icon="i-lucide-check"
                  color="success"
                  block
                  :disabled="!canApprove"
                  :loading="decision.pending.value"
                  @click="decide('approve')"
                >
                  Одобрить
                </UButton>
                <UButton
                  icon="i-lucide-x"
                  color="error"
                  variant="soft"
                  block
                  :disabled="!canDecide"
                  @click="decide('reject')"
                >
                  Отклонить
                </UButton>
              </div>
              <UDropdownMenu :items="moreActions" :content="{ align: 'end' }">
                <UButton
                  color="neutral"
                  variant="ghost"
                  block
                  trailing-icon="i-lucide-chevron-down"
                  class="mt-1"
                >
                  Другие действия
                </UButton>
              </UDropdownMenu>
              <p class="mt-3 text-[11px] leading-snug text-muted">
                Решение не создаёт заявку. Paper-заявка — отдельный шаг с проверкой риска и подтверждением.
              </p>
              <UButton
                v-if="h.status === 'user_approved' && h.direction === 'long'"
                icon="i-lucide-receipt"
                block
                class="mt-3"
                @click="orderOpen = true"
              >
                Создать paper-заявку
              </UButton>
            </UCard>

            <UCard v-if="h.evaluation">
              <div class="mb-3 flex items-center justify-between">
                <p class="section-label">
                  Исход
                </p>
                <UBadge :color="h.evaluation.isCounterfactual ? 'neutral' : 'primary'" size="sm">
                  {{ h.evaluation.isCounterfactual ? 'контрфактический' : 'одобренная' }}
                </UBadge>
              </div>
              <p class="num text-2xl font-semibold" :class="h.evaluation.netReturn >= 0 ? 'text-success' : 'text-error'">
                {{ fmtPct(h.evaluation.netReturn, 2) }}
              </p>
              <p class="text-xs text-muted">
                нетто после издержек {{ fmtPct(h.evaluation.costs.totalPct, 2) }}
              </p>
              <dl class="mt-3 space-y-1.5 text-sm">
                <div class="flex justify-between">
                  <dt class="text-muted">
                    Индекс
                  </dt><dd><DeltaValue :value="h.evaluation.benchmarkReturn" :digits="2" /></dd>
                </div>
                <div class="flex justify-between">
                  <dt class="text-muted">
                    Сверх индекса
                  </dt><dd><DeltaValue :value="h.evaluation.excessReturn" :digits="2" /></dd>
                </div>
                <div class="flex justify-between">
                  <dt class="text-muted">
                    Худшая просадка
                  </dt><dd class="num">
                    {{ fmtPct(h.evaluation.maxDrawdown) }}
                  </dd>
                </div>
                <div class="flex justify-between">
                  <dt class="text-muted">
                    Выход
                  </dt><dd>{{ EXIT_LABELS[h.evaluation.exitReason] ?? h.evaluation.exitReason }}</dd>
                </div>
              </dl>
              <UPopover
                v-if="outcome"
                mode="hover"
                :content="{ side: 'left', align: 'start' }"
              >
                <UButton
                  size="xs"
                  variant="link"
                  icon="i-lucide-notebook-pen"
                  class="mt-2 px-0"
                >
                  Ретроспектива
                </UButton>
                <template #content>
                  <div class="max-w-sm space-y-2 p-3 text-sm">
                    <p class="section-label">
                      outcome_reviewer · {{ outcome.provider }}
                    </p>
                    <p>{{ outcome.summary }}</p>
                    <ul class="space-y-1 text-xs text-muted">
                      <li v-for="(f, i) in outcome.findings" :key="i">
                        {{ f.topic }}: {{ f.detail }}
                      </li>
                    </ul>
                  </div>
                </template>
              </UPopover>
            </UCard>

            <UCard v-if="h.orders.length">
              <p class="section-label mb-2">
                Paper-заявки
              </p>
              <ul class="space-y-1.5 text-sm">
                <li
                  v-for="o in h.orders"
                  :key="o.id"
                  class="flex items-center justify-between gap-2"
                >
                  <span>{{ o.side === 'buy' ? 'Покупка' : 'Продажа' }} <span class="num">{{ o.quantity }}</span></span>
                  <UBadge :color="ORDER_COLORS[o.status] ?? 'neutral'" size="sm">
                    {{ ORDER_LABELS[o.status] ?? o.status }}
                  </UBadge>
                </li>
              </ul>
            </UCard>
          </div>
        </div>

        <OrderTicket
          v-model:open="orderOpen"
          :instrument="h.instrument"
          :hypothesis-id="h.id"
          :entry="h.entryScenario.price"
          :stop-loss="h.exitScenario.stopLoss"
          @created="refresh"
        />
      </template>
    </template>
  </UDashboardPanel>
</template>

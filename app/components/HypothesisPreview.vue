<script setup lang="ts">
const id = defineModel<string | null>('id', { default: null })
const open = computed({
  get: () => Boolean(id.value),
  set: (v) => {
    if (!v) {
      id.value = null
    }
  },
})
const route = useRoute()
watch(() => route.fullPath, () => {
  id.value = null
})
type Detail = ApiResponse<'/api/hypotheses/:id'>
const h = ref<Detail | null>(null)
const status = ref<'idle' | 'pending' | 'error'>('idle')
watch(id, async (v) => {
  h.value = null
  if (!v) {
    return
  }
  status.value = 'pending'
  try {
    const result = await $fetch<Detail>(`/api/hypotheses/${v}`)
    if (id.value === v) {
      h.value = result
    }
    status.value = 'idle'
  } catch {
    status.value = 'error'
  }
})
const critique = computed(() => h.value?.reviews.find(r => r.role === 'critic'))
const bySeverity = computed(() => {
  const findings = critique.value?.findings ?? []
  return {
    critical: findings.filter(f => f.severity === 'critical').length,
    warning: findings.filter(f => f.severity === 'warning').length,
  }
})
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="h ? `${h.instrument.ticker} · ${STRATEGY_LABELS[h.strategyId]}` : 'Гипотеза'"
    :description="h?.instrument.name"
    :ui="{ content: 'max-w-lg' }"
  >
    <template #body>
      <UAlert
        v-if="status === 'error'"
        color="error"
        variant="subtle"
        title="Не удалось загрузить гипотезу"
      />
      <div v-else-if="status === 'pending' && !h" class="space-y-3">
        <USkeleton class="h-5 w-2/3" />
        <USkeleton class="h-20 w-full" />
        <USkeleton class="h-10 w-full" />
      </div>
      <div v-else-if="h" class="space-y-5">
        <div class="flex flex-wrap items-center gap-2">
          <StatusBadge :status="h.status" />
          <VerdictBadge
            :verdict="h.criticVerdict"
            :direction="h.recommendation ?? h.direction"
            :verdict-target="h.verdictTarget"
          />
          <UBadge
            v-if="!h.validation.ok"
            color="error"
            icon="i-lucide-octagon-alert"
          >
            валидация
          </UBadge>
        </div>
        <HypothesisSemantics :h="h" />
        <div v-if="critique" class="space-y-2 rounded-lg bg-elevated/50 p-3">
          <div class="flex items-center justify-between">
            <p class="section-label">
              Критик · {{ critique.provider }}
            </p>
            <span class="flex gap-2 text-xs">
              <span v-if="bySeverity.critical" class="text-error">{{ bySeverity.critical }} критич.</span>
              <span v-if="bySeverity.warning" class="text-warning">{{ bySeverity.warning }} предупр.</span>
            </span>
          </div>
          <p class="text-sm">
            {{ critique.summary }}
          </p>
        </div>
        <div v-if="h.validation.issues.length" class="space-y-1">
          <p class="section-label">
            Кодовая валидация
          </p>
          <p
            v-for="issue in h.validation.issues"
            :key="issue"
            class="text-sm text-error"
          >
            {{ issue }}
          </p>
        </div>
        <dl class="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt class="text-xs text-muted">
              {{ h.semanticVersion === 'decision_v2' ? 'Качество обоснования' : 'Уверенность · legacy' }}
            </dt><dd class="num">
              {{ fmtPct(h.decisionConfidence ?? h.confidence, 0) }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted">
              Горизонт
            </dt><dd class="num">
              {{ h.horizonDays }} {{ h.marketScenario?.horizonUnit === 'confirmed_sessions' ? 'сессий' : 'торг. дн.' }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted">
              Данные на
            </dt><dd>{{ fmtDate(h.evidenceTimestamp) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">
              Правила
            </dt><dd>v{{ h.strategyVersion?.version }}</dd>
          </div>
        </dl>
      </div>
    </template>
    <template v-if="h" #footer>
      <UButton
        :to="`/hypotheses/${h.id}`"
        trailing-icon="i-lucide-arrow-right"
        block
      >
        Открыть карточку и принять решение
      </UButton>
    </template>
  </USlideover>
</template>

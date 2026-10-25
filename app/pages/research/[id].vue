<script setup lang="ts">
const route = useRoute()
const { data: run, refresh } = await useFetch<ApiResponse<'/api/runs/:id'>>(() => `/api/runs/${route.params.id}`)
const preview = ref<string | null>(null)

const active = computed(() => run.value?.status === 'queued' || run.value?.status === 'running')
const { pause, resume } = useIntervalFn(() => refresh(), 2000, { immediate: false })
watch(active, value => value ? resume() : pause(), { immediate: true })

const summary = computed(() => run.value?.summary as null | {
  blockedByDataQuality?: {
    symbol: string
    strategy: string
    reasons: string[]
  }[]
  dependencyChecks?: ({
    symbol: string
    strategy: string
  } & import('#shared/types/market-data').SignalDependencyQuality)[]
  candidates: number
  screenedOut: {
    symbol: string
    strategy: string
    reasons: string[]
  }[]
  failures: {
    symbol: string
    strategy: string
    error: string
  }[]
})
// Count and visible rows come from the same polled response; no stale global-list cache.
const rows = computed(() => run.value?.hypotheses ?? [])
const isLegacyDataBlock = (row: { reasons: string[] }) => row.reasons.some(reason => reason.startsWith('data_quality_blocked:'))
const screenedByStrategy = computed(() => summary.value?.screenedOut.filter(row => !isLegacyDataBlock(row)) ?? [])
const blockedCandidates = computed(() => [...(summary.value?.blockedByDataQuality ?? []), ...(summary.value?.screenedOut.filter(isLegacyDataBlock) ?? [])])
const dataBlocked = computed(() => blockedCandidates.value.length > 0)
const displayStatus = computed(() => run.value?.status === 'completed' && dataBlocked.value ? blockedCandidates.value.length === total.value ? 'blocked' : 'completed_with_blocks' : run.value?.status ?? 'queued')
const done = computed(() => (run.value?.hypotheses.length ?? 0) + (summary.value?.screenedOut.length ?? 0) + (summary.value?.failures.length ?? 0) + (summary.value?.blockedByDataQuality?.length ?? 0))
const total = computed(() => (run.value?.instrumentIds.length ?? 0) * (run.value?.strategies.length ?? 0))
const duration = computed(() => {
  if (!run.value?.startedAt) {
    return null
  }
  const end = run.value.finishedAt ? new Date(run.value.finishedAt).getTime() : Date.now()
  return Math.round((end - new Date(run.value.startedAt).getTime()) / 1000)
})
const showLog = ref(false)
useHead({ title: 'Исследование · IIS' })
</script>

<template>
  <UDashboardPanel id="run">
    <template #header>
      <PageNavbar :title="run?.kind === 'why_not_buy' ? 'Почему не покупать' : 'Исследование'" back="/research">
        <template v-if="run" #title-extra>
          <UBadge
            :color="displayStatus === 'completed' ? 'success' : displayStatus === 'failed' ? 'error' : ['blocked', 'completed_with_blocks'].includes(displayStatus) ? 'warning' : 'primary'"
            :icon="active ? 'i-lucide-loader-circle' : undefined"
            :ui="{ leadingIcon: 'animate-spin' }"
          >
            {{ { blocked: 'заблокировано данными', completed_with_blocks: 'завершено с блокировками', completed: 'завершено', failed: 'ошибка', running: 'идёт анализ', queued: 'в очереди' }[displayStatus] ?? displayStatus }}
          </UBadge>
        </template>
        <template #right>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-scroll-text"
            @click="showLog = true"
          >
            Журнал
          </UButton>
        </template>
      </PageNavbar>
    </template>
    <template #body>
      <template v-if="run">
        <UAlert
          color="neutral"
          class="mb-4"
          :title="run.pinnedStrategies ? 'Правила закреплены в запуске' : 'Legacy: версия правил не была закреплена'"
          description="Для анализа прошлого используется явно выбранный набор правил — это ретроспективный эксперимент. Версии в mock и Finam независимы; параметры и результаты не переносятся автоматически."
        />
        <UAlert
          v-if="dataBlocked"
          color="warning"
          class="mb-4"
          title="Вывод заблокирован качеством данных"
          description="Семантика дневных свечей или календаря не подтверждена. Система сохранила диагностику, но не сформировала новую рекомендацию. Это не сигнал покупать или продавать."
        />
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatTile
            label="Данные на"
            :value="fmtDate(run.asOf)"
            icon="i-lucide-calendar"
          />
          <StatTile
            label="Правила"
            :value="Object.entries(run.rulesVersions).map(([k, v]) => `${STRATEGY_LABELS[k]} v${v}`).join(' · ')"
            icon="i-lucide-git-branch"
          />
          <StatTile
            label="Аналитик / критик"
            :value="`${run.provider} / ${run.criticProvider}`"
            icon="i-lucide-bot"
          />
          <StatTile
            label="Гипотез"
            :value="String(run.hypotheses.length)"
            icon="i-lucide-lightbulb"
            :hint="`нет сетапа ${screenedByStrategy.length} · блокировано ${blockedCandidates.length}`"
          />
          <StatTile
            label="Длительность"
            :value="duration === null ? '—' : duration >= 60 ? `${Math.floor(duration / 60)} мин ${duration % 60} с` : `${duration} с`"
            icon="i-lucide-timer"
          />
        </div>
        <UCard v-if="active">
          <div class="mb-2 flex justify-between text-xs">
            <span class="text-muted">{{ run.log.at(-1)?.message }}</span><span class="num">{{ done }}/{{ total }}</span>
          </div>
          <UProgress :model-value="total ? (done / total) * 100 : null" size="sm" />
        </UCard>
        <UAlert
          v-if="run.error"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-x"
          :title="run.error"
        />

        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Гипотезы
            </h2>
          </template>
          <ul v-if="rows.length" class="divide-y divide-default">
            <HypothesisRow
              v-for="h in rows"
              :key="h.id"
              :h="h"
              @preview="preview = $event"
            />
          </ul>
          <UEmpty
            v-else
            :icon="active ? 'i-lucide-loader-circle' : 'i-lucide-filter-x'"
            :title="active ? 'Идёт анализ…' : 'Гипотез нет'"
            :description="active ? 'Выполняется анализ; страница обновляется сама.' : dataBlocked ? 'Исследование заблокировано данными. Причины перечислены ниже; это не отсутствие сетапа.' : summary?.failures.length ? 'Анализ завершился ошибками; смотрите журнал.' : 'Кандидаты не прошли скрининг стратегии.'"
            size="sm"
            variant="naked"
            class="py-8"
          />
        </UCard>

        <UCard v-if="run.dependencyChecks?.length" class="mb-4">
          <template #header>
            Качество бумаги и зависимости сигнала
          </template>
          <div
            v-for="item in run.dependencyChecks"
            :key="`${item.symbol}:${item.strategy}`"
            class="py-2 text-sm"
          >
            <p>{{ item.symbol }} · {{ item.strategy }} · бумага: {{ item.instrumentQuality }} · сигнал: {{ item.signalEligibility.status === 'eligible' ? 'допущен' : 'заблокирован' }}</p>
            <p class="text-xs text-muted">
              IMOEX: {{ item.benchmarkNeed === 'required_for_signal' ? 'обязателен для сигнала' : 'необязательный контекст' }} · {{ item.benchmarkQuality }}
            </p>
            <p v-if="item.benchmarkUnavailableReason" class="text-xs text-muted">
              {{ item.benchmarkUnavailableReason }}. Индексные сравнения недоступны.
            </p>
          </div>
        </UCard>
        <UCard v-if="blockedCandidates.length" class="mb-4">
          <template #header>
            Заблокированы качеством данных · {{ blockedCandidates.length }}
          </template>
          <div
            v-for="item in blockedCandidates"
            :key="`${item.symbol}:${item.strategy}`"
            class="py-2 text-sm"
          >
            <strong>{{ item.symbol }} · {{ item.strategy }}</strong>
            <p
              v-for="reason in item.reasons"
              :key="reason"
              class="break-words text-xs text-muted"
            >
              {{ reason }}
            </p>
          </div>
        </UCard>
        <UAlert
          v-if="run.researchSelection"
          class="mb-4"
          color="neutral"
          :title="`${run.researchSelection.provider} · ${run.researchSelection.policyId}`"
          :description="`Набор входных данных: ${run.researchSelection.inputSetVersion}. Ревизии закреплены на ${fmtDate(run.researchSelection.revisionCutoff, true)}. Прошлые запуски не переинтерпретируются.`"
        />
        <UButton
          v-if="!active"
          to="/research"
          color="neutral"
          variant="outline"
          class="mb-4"
        >
          Новое исследование
        </UButton>
        <div class="grid gap-4 lg:grid-cols-2">
          <UCard v-if="screenedByStrategy.length" :ui="{ body: 'p-0 sm:p-0' }">
            <template #header>
              <p class="section-label">
                Отсеяны скринингом · {{ screenedByStrategy.length }}
              </p>
            </template>
            <ul class="divide-y divide-default">
              <li
                v-for="s in screenedByStrategy"
                :key="s.symbol + s.strategy"
                class="flex items-start gap-3 px-4 py-2.5 text-sm sm:px-5"
              >
                <span class="w-14 shrink-0 font-medium text-highlighted">{{ s.symbol.split('@')[0] }}</span>
                <UBadge
                  color="neutral"
                  size="sm"
                  class="shrink-0"
                >
                  {{ STRATEGY_LABELS[s.strategy] }}
                </UBadge>
                <span class="text-xs text-muted">{{ s.reasons.join(' · ') }}</span>
              </li>
            </ul>
          </UCard>
          <UCard v-if="summary?.failures.length" :ui="{ body: 'p-0 sm:p-0' }">
            <template #header>
              <p class="section-label text-error">
                Ошибки · {{ summary.failures.length }}
              </p>
            </template>
            <ul class="divide-y divide-default">
              <li
                v-for="f in summary.failures"
                :key="f.symbol + f.strategy"
                class="px-4 py-2.5 text-sm sm:px-5"
              >
                <span class="font-medium">{{ f.symbol }}</span> · {{ STRATEGY_LABELS[f.strategy] }} — <span class="text-error">{{ f.error }}</span>
              </li>
            </ul>
          </UCard>
        </div>
      </template>
      <HypothesisPreview v-model:id="preview" />
      <USlideover
        v-model:open="showLog"
        title="Журнал запуска"
        :ui="{ content: 'max-w-xl' }"
      >
        <template #body>
          <ol class="space-y-1.5 font-mono text-xs">
            <li
              v-for="(entry, i) in run?.log ?? []"
              :key="i"
              class="flex gap-3"
              :class="{ 'text-error': entry.level === 'error', 'text-warning': entry.level === 'warn' }"
            >
              <span class="shrink-0 text-dimmed">{{ new Date(entry.at).toLocaleTimeString('ru-RU') }}</span>
              <span>{{ entry.message }}</span>
            </li>
          </ol>
        </template>
      </USlideover>
    </template>
  </UDashboardPanel>
</template>

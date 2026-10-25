<script setup lang="ts">
import type { StrategyId } from '#shared/types/investment'

const { data: overview } = await useFetch('/api/instruments/overview')
const { data: marketData } = await useFetch('/api/market-data')
const { data: runs, refresh } = await useFetch('/api/runs')
const { data: status } = useSystemStatus()
const start = useAction()

const kind = ref<'research' | 'why_not_buy'>('research')
const strategies = ref<StrategyId[]>(['swing'])
const selected = ref<string[]>([])
const asOf = ref('')
const researchBarsProvider = shallowRef<'configured' | 'moex_iss'>('configured')
const barSources = [{
  label: 'Текущий источник (настройки)',
  value: 'configured',
}, {
  label: 'MOEX ISS · физические сессии · реконструкция',
  value: 'moex_iss',
}]

const equities = computed(() => (overview.value ?? []).filter(i => i.kind === 'equity').sort((a, b) => a.ticker.localeCompare(b.ticker)))
const versionOf = (s: StrategyId) => equities.value[0]?.signals.find(x => x.strategy === s)?.version
const setupsCalculated = computed(() => !asOf.value && researchBarsProvider.value === 'configured')
const hasSetup = (i: (typeof equities.value)[number], s?: StrategyId) => setupsCalculated.value && i.signals.some(x => x.setup && (s ? x.strategy === s : strategies.value.includes(x.strategy as StrategyId)))

function toggle(id: string) {
  selected.value = selected.value.includes(id) ? selected.value.filter(x => x !== id) : [...selected.value, id]
}
function pickSetups() {
  if (!setupsCalculated.value) {
    return
  }
  selected.value = equities.value.filter(i => hasSetup(i)).map(i => i.id)
}
function toggleStrategy(s: StrategyId) {
  strategies.value = strategies.value.includes(s) ? strategies.value.filter(x => x !== s) : [...strategies.value, s]
}

// Estimate is exact for "today": screening is deterministic and only setups reach the agents.
const estimate = computed(() => {
  const candidates = selected.value.length * strategies.value.length
  const live = !asOf.value && researchBarsProvider.value === 'configured'
  const withSetup = equities.value.filter(i => selected.value.includes(i.id)).reduce((n, i) => n + i.signals.filter(s => s.setup && strategies.value.includes(s.strategy as StrategyId)).length, 0)
  const toAgents = live ? kind.value === 'why_not_buy' ? equities.value.filter(i => selected.value.includes(i.id) && i.dataQuality.status !== 'data_quality_blocked').length * strategies.value.length : withSetup : null
  const perCall = status.value?.analyst.id === 'mock' ? 0.05 : 14
  return {
    candidates,
    toAgents,
    calls: toAgents === null ? null : toAgents * 3,
    seconds: toAgents === null ? null : Math.ceil(toAgents / 2) * 3 * perCall,
  }
})

const presets = [
  {
    label: 'Сегодня',
    value: '',
  },
  {
    label: '1 мес. назад',
    value: ago(30),
  },
  {
    label: '3 мес. назад',
    value: ago(91),
  },
  {
    label: '6 мес. назад',
    value: ago(182),
  },
]
function ago(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
}

async function submit() {
  const run = await start.run(() => $fetch<ApiResponse<'/api/runs', 'post'>>('/api/runs', {
    method: 'POST',
    body: {
      researchBarsProvider: researchBarsProvider.value === 'moex_iss' ? 'moex_iss' : undefined,
      kind: kind.value,
      strategies: strategies.value,
      instrumentIds: selected.value,
      asOf: asOf.value || undefined,
    },
  }), 'Исследование запущено')
  if (run) {
    await refresh()
    await navigateTo(`/research/${run.id}`)
  }
}
useHead({ title: 'Исследования · IIS' })
</script>

<template>
  <UDashboardPanel id="research">
    <template #header>
      <PageNavbar title="Исследования" />
    </template>
    <template #body>
      <div class="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <UCard :ui="{ body: 'space-y-6' }">
          <div>
            <p class="section-label mb-2">
              Режим
            </p>
            <div class="grid gap-2 sm:grid-cols-2">
              <button
                v-for="m in [{ value: 'research', icon: 'i-lucide-telescope', title: 'Исследование', text: 'Найти сетапы по правилам и сформулировать гипотезы' }, { value: 'why_not_buy', icon: 'i-lucide-ban', title: 'Почему не покупать', text: 'Разобрать выбранное, даже без сетапа' }] as const"
                :key="m.value"
                type="button"
                class="flex gap-3 rounded-lg p-3 text-left ring transition-colors"
                :class="kind === m.value ? 'bg-primary/5 ring-primary' : 'ring-default hover:bg-elevated/50'"
                @click="kind = m.value"
              >
                <UIcon
                  :name="m.icon"
                  class="mt-0.5 size-5 shrink-0"
                  :class="kind === m.value ? 'text-primary' : 'text-muted'"
                />
                <span>
                  <span class="block text-sm font-medium text-highlighted">{{ m.title }}</span>
                  <span class="block text-xs text-muted">{{ m.text }}</span>
                </span>
              </button>
            </div>
          </div>

          <div>
            <p class="section-label mb-2">
              Стратегии
            </p>
            <div class="flex flex-wrap gap-2">
              <UButton
                v-for="s in (['swing', 'position'] as const)"
                :key="s"
                :color="strategies.includes(s) ? 'primary' : 'neutral'"
                :variant="strategies.includes(s) ? 'subtle' : 'outline'"
                :icon="strategies.includes(s) ? 'i-lucide-check' : 'i-lucide-plus'"
                @click="toggleStrategy(s)"
              >
                {{ STRATEGY_LABELS[s] }}
                <span class="num text-xs opacity-70">v{{ versionOf(s) ?? '?' }}</span>
              </UButton>
            </div>
          </div>

          <div>
            <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p class="section-label">
                Инструменты · <span class="num">{{ selected.length }}</span>
              </p>
              <div class="flex gap-1">
                <UButton
                  size="xs"
                  variant="soft"
                  icon="i-lucide-radar"
                  :disabled="!setupsCalculated"
                  :title="setupsCalculated ? undefined : 'Не рассчитано для выбранного источника/даты; выполните ручное исследование'"
                  @click="pickSetups"
                >
                  С сетапами сейчас
                </UButton>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  @click="selected = equities.map(i => i.id)"
                >
                  Все
                </UButton>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  @click="selected = []"
                >
                  Сброс
                </UButton>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
              <button
                v-for="i in equities"
                :key="i.id"
                type="button"
                class="relative flex flex-col items-start rounded-md px-2.5 py-2 text-left ring transition-colors"
                :class="selected.includes(i.id) ? 'bg-primary/5 ring-primary' : 'ring-default hover:bg-elevated/50'"
                @click="toggle(i.id)"
              >
                <span class="flex w-full items-center justify-between">
                  <span class="text-sm font-semibold text-highlighted">{{ i.ticker }}</span>
                  <UTooltip v-if="hasSetup(i)" text="Есть сетап по выбранной стратегии сейчас">
                    <span class="size-1.5 rounded-full bg-primary" />
                  </UTooltip>
                </span>
                <span class="w-full truncate text-[11px] text-muted">{{ i.name }}</span>
                <DeltaValue :value="i.change1d" class="text-[11px]" />
              </button>
            </div>
          </div>

          <div>
            <UFormField label="Источник исследовательских свечей" class="mb-4">
              <USelect
                v-model="researchBarsProvider"
                :items="barSources"
                class="w-full"
              />
              <p v-if="researchBarsProvider === 'moex_iss'" class="mt-2 text-xs text-muted">
                Явный выбор нового набора входных данных: дневной OHLCV сверяется с часовой историей. Горизонт — подтверждённые физические сессии, включая выходные при наличии торгов. Историческая доступность и корректировки неизвестны; long и paper остаются под ограничениями. Перед запуском — ручная синхронизация выбранных бумаг и индекса, это может занять несколько минут.
              </p>
            </UFormField>
            <details v-if="marketData?.series.length" class="mb-4 text-xs text-muted">
              <summary class="cursor-pointer">
                Источники: сверка с часовой историей · {{ marketData.series.length }} инструментов
              </summary>
              <div
                v-for="series in marketData.series"
                :key="series.id"
                class="mt-2 border-l border-default pl-2"
              >
                <p>{{ overview?.find(i => i.id === series.instrumentId)?.ticker ?? series.instrumentId }} · {{ series.source }} / {{ series.board }} · {{ series.policyId }}</p>
                <p>{{ series.from }} — {{ series.to }} · получено {{ fmtDate(series.observedAt, true) }}</p>
                <p>Реконструкция: {{ series.counts.research_usable_with_limits }} · карантин: {{ series.counts.quarantined }}</p>
                <p v-for="item in series.quarantine" :key="item.date">
                  {{ item.date }}: {{ item.issues.join(', ') }}
                </p>
              </div>
            </details>
            <p class="section-label mb-2">
              Данные на дату
            </p>
            <div class="flex flex-wrap items-center gap-2">
              <UFieldGroup>
                <UButton
                  v-for="p in presets"
                  :key="p.label"
                  :color="asOf === p.value ? 'primary' : 'neutral'"
                  :variant="asOf === p.value ? 'subtle' : 'outline'"
                  size="sm"
                  @click="asOf = p.value"
                >
                  {{ p.label }}
                </UButton>
              </UFieldGroup>
              <AppDatePicker
                v-model="asOf"
                size="sm"
                :max="new Date().toISOString().slice(0, 10)"
                class="w-40"
              />
            </div>
            <p class="mt-1.5 text-xs text-muted">
              В прошлом — честная ретро-проверка: агенты видят только данные, доступные к концу того дня, а исход можно оценить сразу.
            </p>
          </div>
        </UCard>

        <div class="space-y-4 xl:sticky xl:top-0 xl:self-start">
          <UCard>
            <p class="section-label mb-3">
              Запуск
            </p>
            <dl class="space-y-2 text-sm">
              <div class="flex justify-between">
                <dt class="text-muted">
                  Кандидатов
                </dt><dd class="num text-highlighted">
                  {{ estimate.candidates }}
                </dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-muted">
                  Дойдут до ИИ
                </dt><dd class="num text-highlighted">
                  {{ estimate.toAgents ?? 'после скрининга' }}
                </dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-muted">
                  Вызовов агентов
                </dt><dd class="num">
                  {{ estimate.calls ?? '≤ ' + estimate.candidates * 3 }}
                </dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-muted">
                  Примерно
                </dt><dd class="num">
                  {{ estimate.seconds === null ? '—' : estimate.seconds < 60 ? `${Math.max(1, Math.round(estimate.seconds))} с` : `${Math.round(estimate.seconds / 60)} мин` }}
                </dd>
              </div>
            </dl>
            <USeparator class="my-3" />
            <p class="text-xs text-muted">
              Цепочка: скрининг кодом → исследователь → аналитик → <span class="text-highlighted">независимый критик</span> → кодовая валидация.
              Провайдер: <span class="num">{{ status?.analyst.id }}/{{ status?.critic.id }}</span>.
            </p>
            <UButton
              block
              size="lg"
              icon="i-lucide-play"
              class="mt-4"
              :loading="start.pending.value"
              :disabled="!selected.length || !strategies.length"
              @click="submit"
            >
              Исследовать
            </UButton>
          </UCard>
        </div>
      </div>

      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-semibold text-highlighted">
              История запусков
            </h2>
            <UButton
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="ghost"
              size="sm"
              square
              aria-label="Обновить"
              @click="() => refresh()"
            />
          </div>
        </template>
        <ul class="divide-y divide-default">
          <RunRow
            v-for="r in runs ?? []"
            :key="r.id"
            :run="r"
          />
          <li v-if="!runs?.length" class="px-5 py-4 text-sm text-muted">
            Запусков ещё не было.
          </li>
        </ul>
      </UCard>
    </template>
  </UDashboardPanel>
</template>

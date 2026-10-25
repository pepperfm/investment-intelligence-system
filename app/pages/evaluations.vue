<script setup lang="ts">
const { data, refresh } = await useFetch('/api/evaluations')
const action = useAction()
const reviewAction = useAction()
async function review(hypothesisId: string) {
  await reviewAction.run(() => $fetch<ApiResponse<'/api/evaluations/:id/review', 'post'>>(`/api/evaluations/${hypothesisId}/review`, { method: 'POST' }), 'Ретроспектива сохранена отдельной версией')
  await refresh()
}
const tab = ref<'all' | 'swing' | 'position'>('all')
const preview = ref<string | null>(null)
const showHistory = shallowRef(false)
const EVALUATION_LABELS: Record<string, string> = {
  evaluated: 'Рассчитано',
  not_entered: 'Входа не было',
  missing_future_data: 'Нет будущих данных',
  ambiguous_session: 'Сессии не подтверждены',
  incomplete_horizon: 'Горизонт неполон',
  legacy: 'Legacy · старый расчёт',
}

async function evaluate() {
  await action.run(() => $fetch<ApiResponse<'/api/evaluations/run', 'post'>>('/api/evaluations/run', { method: 'POST' }), r => `Оценено ${r.evaluated}, ретроспектив ${r.reviewed}, неполных или заблокированных ${r.pending}${r.reviewErrors.length ? `, ошибок ретро ${r.reviewErrors.length}` : ''}`)
  await refresh()
}

const stats = computed(() => data.value?.stats[tab.value])
const rows = computed(() => {
  const s = stats.value
  return s
    ? [
        {
          label: 'Все long-идеи',
          stats: s.all,
        },
        {
          label: 'Одобренные вами',
          stats: s.approved,
          hint: 'симуляции одобренных идей, не исполнения',
        },
        {
          label: 'Все сценарные симуляции',
          stats: s.counterfactual,
          hint: 'контрфактически',
        },
        {
          label: 'Критик подтвердил решение',
          stats: s.criticSupported,
        },
        {
          label: 'Критик оспорил / мало данных',
          stats: s.criticDisputed,
        },
        {
          label: '«Не покупать», если бы купили',
          stats: s.whyNotBuy,
          hint: 'альтернативные покупки; не точность решения',
        },
      ]
    : []
})
const chart = computed(() => rows.value.filter(r => r.stats.traded).map(r => ({
  sample: r.label.replace('Критик ', '').replace(' / мало данных', ''),
  net: +(r.stats.avgNetReturn * 100).toFixed(2),
  bench: r.stats.avgBenchmarkReturn === null ? null : +(r.stats.avgBenchmarkReturn * 100).toFixed(2),
})))
const list = computed(() => (data.value?.rows ?? []).filter(r => (showHistory.value || r.isLatest) && (tab.value === 'all' || r.strategyId === tab.value)))
const exits = computed(() => {
  const counts: Record<string, number> = {}
  for (const r of list.value.filter(row => row.status === 'evaluated' || row.status === 'not_entered')) {
    counts[r.evaluation.exitReason] = (counts[r.evaluation.exitReason] ?? 0) + 1
  }
  return Object.entries(counts).map(([reason, n]) => ({
    reason,
    label: EXIT_LABELS[reason] ?? reason,
    n,
  }))
})
const EXIT_COLORS: Record<string, string> = {
  take_profit: 'success',
  stop_loss: 'error',
  time_exit: 'warning',
}
useHead({ title: 'Оценки · IIS' })
</script>

<template>
  <UDashboardPanel id="evaluations">
    <template #header>
      <PageNavbar title="Оценки и ретроспективы" :badge="data?.rows.length">
        <template #right>
          <UPopover mode="hover" :content="{ align: 'end' }">
            <UButton
              icon="i-lucide-circle-help"
              color="neutral"
              variant="ghost"
              square
              aria-label="Как считается"
            />
            <template #content>
              <div class="max-w-sm space-y-2 p-3 text-xs">
                <p class="section-label">
                  Как считается исход
                </p>
                <p>Вход на открытии после даты данных; выход по стопу, цели или горизонту. Комиссия, спред и проскальзывание вычитаются.</p>
                <p>Если стоп и цель задеты в один день — засчитывается стоп. Гэп через стоп исполняется по открытию.</p>
                <p>Все показанные покупки — условные сценарии, включая одобренные идеи. Фактические paper-исполнения находятся в портфеле. Кнопка запускает только расчёт, без AI.</p>
              </div>
            </template>
          </UPopover>
          <UButton
            icon="i-lucide-target"
            :loading="action.pending.value"
            @click="evaluate"
          >
            Оценить созревшие
          </UButton>
        </template>
      </PageNavbar>
      <UDashboardToolbar>
        <UTabs
          v-model="tab"
          :items="[{ label: 'Все', value: 'all' }, { label: 'Swing', value: 'swing' }, { label: 'Position', value: 'position' }]"
          :content="false"
          variant="link"
          size="sm"
          class="-mb-px"
        />
      </UDashboardToolbar>
    </template>
    <template #body>
      <UAlert
        v-if="stats?.includesReconstruction"
        color="warning"
        title="Статистика включает историческую реконструкцию"
        description="Данные получены позже даты сценария. Историческое время публикации и корректировки неизвестны; это условные расчёты, а не подтверждённая торговая результативность."
        class="mb-4"
      />
      <div class="grid gap-4 xl:grid-cols-3">
        <UCard class="xl:col-span-2">
          <div class="mb-3 flex items-center justify-between">
            <p class="section-label">
              Выборки
            </p>
            <span class="text-xs text-muted">индекс за те же периоды: <DeltaValue
              v-if="stats?.benchmarkAvg !== null && stats?.benchmarkAvg !== undefined"
              :value="stats.benchmarkAvg"
              :digits="2"
              :arrow="false"
            /></span>
          </div>
          <StatsGrid :rows="rows" />
          <p class="mt-3 text-xs text-muted">
            В статистике только последние завершённые расчёты новой версии. Выборки пересекаются. Одна прибыльная или убыточная условная покупка не доказывает правильность решения «не покупать».
          </p>
        </UCard>
        <UCard :ui="{ body: 'space-y-4' }">
          <div>
            <p class="section-label mb-2">
              Средняя сделка vs индекс, %
            </p>
            <UChart
              v-if="chart.length"
              type="bar"
              :data="chart"
              index="sample"
              :categories="[{ key: 'net', label: 'Нетто' }, { key: 'bench', label: 'Индекс' }]"
              :colors="['primary', 'var(--ui-text-dimmed)']"
              :height="190"
              :x-axis="false"
              :format="(v: number) => `${v.toFixed(2)}%`"
            />
          </div>
          <div v-if="exits.length">
            <p class="section-label mb-2">
              Причины выхода
            </p>
            <UProgressGroup
              :items="exits.map(e => ({ label: `${e.label} · ${e.n}`, value: e.n, color: EXIT_COLORS[e.reason] ?? 'var(--ui-border-accented)' }))"
              :max="list.length"
              size="md"
            />
          </div>
        </UCard>
      </div>

      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <template #header>
          <p class="section-label">
            Сценарии и решения
          </p>
          <UCheckbox
            v-model="showHistory"
            label="Показать предыдущие версии и legacy"
            class="mt-2"
          />
        </template>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-left text-xs text-muted">
              <tr class="border-b border-default">
                <th class="px-5 py-2 font-medium">
                  Инструмент
                </th><th class="px-3 py-2 font-medium">
                  Критик
                </th><th class="px-3 py-2 font-medium">
                  Состояние / выход
                </th><th class="px-3 py-2 text-right font-medium">
                  Нетто
                </th><th class="px-3 py-2 text-right font-medium">
                  Индекс
                </th><th class="px-3 py-2 text-right font-medium">
                  Просадка
                </th><th class="px-5 py-2 font-medium">
                  Решение / аудит
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-default">
              <tr
                v-for="r in list"
                :key="r.evaluation.id"
                class="cursor-pointer hover:bg-elevated/40"
                @click="preview = r.hypothesisId"
              >
                <td class="px-5 py-2.5">
                  <span class="font-semibold text-highlighted">{{ r.symbol.split('@')[0] }}</span>
                  <span class="ml-2 text-xs text-muted">{{ STRATEGY_LABELS[r.strategyId] }}{{ r.direction === 'no_trade' ? ' · не покупать' : '' }}</span>
                </td>
                <td class="px-3 py-2.5">
                  <VerdictBadge
                    :verdict="r.criticVerdict"
                    :direction="r.direction"
                    :verdict-target="r.verdictTarget"
                    size="xs"
                  />
                </td>
                <td class="px-3 py-2.5 text-xs text-muted">
                  <p>{{ EVALUATION_LABELS[r.status] ?? r.status }}</p>
                  <p v-if="r.status === 'evaluated'">
                    {{ EXIT_LABELS[r.evaluation.exitReason] ?? r.evaluation.exitReason }}
                  </p>
                  <details
                    v-if="r.issues.length"
                    class="mt-1 max-w-xs"
                    @click.stop
                  >
                    <summary>Диагностика · {{ r.issues.length }}</summary>
                    <p
                      v-for="issue in r.issues"
                      :key="issue"
                      class="mt-1 text-xs text-warning"
                    >
                      {{ issue }}
                    </p>
                  </details>
                </td>
                <td class="px-3 py-2.5 text-right">
                  <DeltaValue
                    v-if="r.evaluation.netReturn !== null"
                    :value="r.evaluation.netReturn"
                    :digits="2"
                  /><span v-else>—</span>
                </td>
                <td class="px-3 py-2.5 text-right">
                  <DeltaValue
                    v-if="r.evaluation.benchmarkReturn !== null"
                    :value="r.evaluation.benchmarkReturn"
                    :digits="2"
                    :arrow="false"
                  />
                </td>
                <td class="num px-3 py-2.5 text-right text-muted">
                  {{ r.evaluation.maxDrawdown === null ? '—' : fmtPct(r.evaluation.maxDrawdown) }}
                </td>
                <td class="px-5 py-2.5">
                  <UBadge color="neutral" size="sm">
                    Условная покупка
                  </UBadge>
                  <div v-if="r.decisionEvaluation?.recommendation === 'no_trade'" class="mt-1 text-xs text-muted">
                    <p>Альтернатива: деньги · 0%</p>
                    <p>Избежанный убыток: {{ r.decisionEvaluation.avoidedLoss === null ? '—' : fmtPct(r.decisionEvaluation.avoidedLoss) }}</p>
                    <p>Упущенный рост: {{ r.decisionEvaluation.missedGain === null ? '—' : fmtPct(r.decisionEvaluation.missedGain) }}</p>
                    <p>{{ r.semanticVersion === 'legacy' ? 'Исходный вердикт · legacy' : 'Вердикт по решению' }}: {{ VERDICT_LABELS[r.decisionEvaluation.evidenceQuality.decisionVerdict ?? ''] ?? 'не оценено' }}</p>
                  </div>
                  <details class="mt-2 max-w-xs break-all text-xs text-muted" @click.stop>
                    <summary>Версия и воспроизводимость</summary>
                    <p>{{ r.evaluationVersion }} · {{ r.calendarVersion }}</p>
                    <p>{{ fmtDate(r.evaluation.evaluatedAt, true) }}</p>
                    <p>Издержки: {{ r.costModelHash }}</p>
                    <p>Исходный snapshot: {{ r.sourceSnapshotHash }}</p>
                  </details>
                  <UButton
                    v-if="r.isLatest && r.status === 'evaluated'"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    class="mt-2"
                    :loading="reviewAction.pending.value"
                    @click.stop="review(r.hypothesisId)"
                  >
                    Разобрать исход · AI
                  </UButton>
                </td>
              </tr>
            </tbody>
          </table>
          <UEmpty
            v-if="!list.length"
            icon="i-lucide-target"
            title="Пока нет оценок"
            description="Совет: запустите исследование «на дату» в прошлом — исход рассчитывается только при полном горизонте и подтверждённых сессиях."
            :actions="[{ label: 'Оценить созревшие', onClick: evaluate, loading: action.pending.value }]"
            variant="naked"
            class="py-10"
          />
        </div>
      </UCard>
      <HypothesisPreview v-model:id="preview" />
    </template>
  </UDashboardPanel>
</template>

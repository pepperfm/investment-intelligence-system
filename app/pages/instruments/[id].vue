<script setup lang="ts">
const route = useRoute()
const { data } = await useFetch<ApiResponse<'/api/instruments/:id'>>(() => `/api/instruments/${route.params.id}`)
const { data: hypotheses } = await useFetch('/api/hypotheses', { query: { instrumentId: String(route.params.id) } })
const preview = ref<string | null>(null)
const tab = ref('events')

const metrics = computed(() => data.value?.signals[0]?.metrics)
const last = computed(() => data.value?.candles.at(-1))
const prev = computed(() => data.value?.candles.at(-2))
const change = computed(() => last.value && prev.value ? last.value.close / prev.value.close - 1 : null)
const spec = computed(() => metrics.value
  ? [
      {
        group: 'Тренд',
        rows: [
          ['SMA20', fmtNum(metrics.value.sma20)],
          ['SMA50', fmtNum(metrics.value.sma50)],
          ['SMA200', fmtNum(metrics.value.sma200)],
          ['RSI14', fmtNum(metrics.value.rsi14, 1)],
        ],
      },
      {
        group: 'Моментум',
        rows: [
          ['20 дней', metrics.value.momentum20],
          ['60 дней', metrics.value.momentum60],
          ['120 дней', metrics.value.momentum120],
        ],
      },
      {
        group: 'Риск и ликвидность',
        rows: [
          ['ATR14', `${fmtNum(metrics.value.atr14)} · ${fmtPct(metrics.value.atrPct)}`],
          ['Волатильность 60д', fmtPct(metrics.value.volatility60)],
          ['Просадка 250д', fmtPct(metrics.value.drawdown250)],
          ['Оборот 20д', fmtMoney(metrics.value.avgTurnover20)],
        ],
      },
    ]
  : [])
function asRatio(v: unknown) {
  return typeof v === 'number' ? v : null
}
useHead({ title: computed(() => `${data.value?.instrument.ticker ?? ''} · IIS`) })
</script>

<template>
  <UDashboardPanel id="instrument">
    <template #header>
      <PageNavbar :title="data ? data.instrument.ticker : 'Инструмент'" back="/instruments">
        <template v-if="data" #title-extra>
          <span class="hidden truncate text-sm font-normal text-muted sm:inline">{{ data.instrument.name }}</span>
        </template>
        <template #right>
          <UButton icon="i-lucide-flask-conical" to="/research">
            Исследовать
          </UButton>
        </template>
      </PageNavbar>
    </template>
    <template #body>
      <UAlert
        v-if="data?.dataQuality.status === 'data_quality_blocked'"
        color="warning"
        class="mb-4"
        title="Сырые котировки · расчётные периоды не подтверждены"
        description="График показывает исходные значения поставщика. Индикаторы и сетапы заблокированы до подтверждения контракта дневных свечей и календаря."
      />
      <template v-if="data">
        <div class="grid gap-4 xl:grid-cols-[1fr_20rem]">
          <UCard>
            <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p class="num text-3xl font-semibold tracking-tight text-highlighted">
                  {{ fmtNum(last?.close) }} <span class="text-base font-normal text-muted">{{ data.instrument.currency }}</span>
                </p>
                <p class="flex items-center gap-2 text-sm">
                  <DeltaValue :value="change" :digits="2" />
                  <span class="text-muted">за день · {{ fmtDate(last?.ts) }}</span>
                </p>
              </div>
              <div class="flex flex-wrap gap-1.5">
                <UBadge color="neutral" size="sm">
                  {{ SECTOR_LABELS[data.instrument.sector] ?? data.instrument.sector }}
                </UBadge>
                <UBadge
                  color="neutral"
                  size="sm"
                  class="num"
                >
                  лот {{ data.instrument.lotSize }}
                </UBadge>
                <UBadge
                  color="neutral"
                  size="sm"
                  class="num"
                >
                  {{ data.instrument.symbol }}
                </UBadge>
              </div>
            </div>
            <PriceChart
              :candles="data.candles"
              :height="400"
              :indicators="data.dataQuality.status === 'verified'"
              :ranges="data.dataQuality.status === 'verified'"
            />
          </UCard>
          <div class="space-y-4">
            <UCard :ui="{ body: 'space-y-3' }">
              <p class="section-label">
                Сигналы активных правил
              </p>
              <div
                v-for="s in data.signals"
                :key="s.strategy"
                class="rounded-lg p-3 ring"
                :class="s.setup ? 'bg-primary/5 ring-primary/40' : 'ring-default'"
              >
                <div class="flex items-center justify-between">
                  <span class="text-sm font-medium text-highlighted">{{ STRATEGY_LABELS[s.strategy] }} <span class="num text-xs text-muted">v{{ s.version }}</span></span>
                  <UBadge :color="s.setup ? 'primary' : 'neutral'" size="sm">
                    {{ s.setup ? s.setupType : 'нет сетапа' }}
                  </UBadge>
                </div>
                <LevelsBar
                  v-if="s.setup && s.entry && s.stopLoss && s.takeProfit"
                  class="mt-3"
                  :entry="s.entry"
                  :stop="s.stopLoss"
                  :target="s.takeProfit"
                />
                <UCollapsible class="mt-2" :default-open="!s.setup">
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="link"
                    trailing-icon="i-lucide-chevron-down"
                    class="px-0"
                    :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform' }"
                  >
                    {{ s.reasons.length }} за · {{ s.failures.length }} против
                  </UButton>
                  <template #content>
                    <ul class="mt-1 space-y-1 text-xs">
                      <li
                        v-for="r in s.reasons"
                        :key="r"
                        class="flex gap-1.5"
                      >
                        <UIcon name="i-lucide-check" class="mt-0.5 size-3.5 shrink-0 text-success" />{{ r }}
                      </li>
                      <li
                        v-for="f in s.failures"
                        :key="f"
                        class="flex gap-1.5"
                      >
                        <UIcon name="i-lucide-x" class="mt-0.5 size-3.5 shrink-0 text-error" />{{ f }}
                      </li>
                    </ul>
                  </template>
                </UCollapsible>
              </div>
            </UCard>
            <UCard :ui="{ body: 'space-y-4' }">
              <div v-for="g in spec" :key="g.group">
                <p class="section-label mb-1.5">
                  {{ g.group }}
                </p>
                <dl class="space-y-1 text-sm">
                  <div
                    v-for="[k, v] in g.rows"
                    :key="String(k)"
                    class="flex justify-between gap-2"
                  >
                    <dt class="text-muted">
                      {{ k }}
                    </dt>
                    <dd>
                      <DeltaValue v-if="typeof v === 'number' || v === null" :value="asRatio(v)" />
                      <span v-else class="num">{{ v }}</span>
                    </dd>
                  </div>
                </dl>
              </div>
            </UCard>
          </div>
        </div>

        <UCard :ui="{ header: 'p-0 sm:px-2 border-b border-default', body: 'p-0 sm:p-0' }">
          <template #header>
            <UTabs
              v-model="tab"
              :items="[{ label: 'События', value: 'events', icon: 'i-lucide-newspaper', badge: String(data.events.length) }, { label: 'Отчётность', value: 'reports', icon: 'i-lucide-file-spreadsheet' }, { label: 'Финансы', value: 'fundamentals', icon: 'i-lucide-file-check' }, { label: 'Банк и лицензии', value: 'bank', icon: 'i-lucide-landmark' }, { label: 'Макро', value: 'macro', icon: 'i-lucide-landmark' }, { label: 'Гипотезы', value: 'hypotheses', icon: 'i-lucide-lightbulb', badge: String(hypotheses?.length ?? 0) }]"
              :content="false"
              variant="link"
              size="sm"
              class="-mb-px"
            />
          </template>
          <ul v-if="tab === 'events'" class="max-h-[28rem] divide-y divide-default overflow-y-auto">
            <li
              v-for="e in data.events"
              :key="e.id"
              class="flex gap-3 px-4 py-2.5 sm:px-5"
            >
              <span class="mt-1.5 size-1.5 shrink-0 rounded-full" :class="(e.sentiment ?? 0) > 0.25 ? 'bg-success' : (e.sentiment ?? 0) < -0.25 ? 'bg-error' : 'bg-(--ui-text-dimmed)'" />
              <div class="min-w-0">
                <p class="text-sm text-highlighted">
                  <a
                    v-if="e.url"
                    :href="e.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="hover:underline"
                  >{{ e.title }}</a>
                  <span v-else>{{ e.title }}</span>
                </p>
                <p class="text-xs text-muted">
                  {{ fmtDate(e.publishedAt) }} · {{ e.source }} · {{ e.kind }}
                </p>
              </div>
            </li>
            <li v-if="!data.events.length" class="px-5 py-4 text-sm text-muted">
              В текущей ленте нет новостей по этому эмитенту. Это не означает отсутствия корпоративных рисков.
            </li>
          </ul>
          <div v-else-if="tab === 'bank'" class="p-5">
            <BankEvidencePanel :context="data.bankEvidence" />
          </div>
          <div v-else-if="tab === 'fundamentals'" class="space-y-3 p-5">
            <p class="text-xs text-muted">
              Проверенные факты первичных документов. Банковские формы относятся к отдельному юридическому лицу; стандарты и консолидация не взаимозаменяемы.
            </p>
            <div
              v-for="fact in data.issuerFundamentals"
              :key="fact.id"
              class="rounded-lg bg-elevated p-3 text-sm"
            >
              <p class="num">
                {{ fact.metricKey }}: {{ fact.value }} {{ fact.unit }}
              </p>
              <p class="text-xs text-muted">
                {{ fact.verification === 'machine_verified' ? 'Сверено кодом' : 'Подтверждено пользователем' }} · {{ fact.reportingStandard }} · {{ fact.basis === 'non_ifrs' ? 'non-IFRS' : 'Отчётный показатель' }} · {{ fact.consolidated ? 'Группа' : 'Юридическое лицо' }} · {{ fact.periodStart }} — {{ fact.periodEnd }}
              </p>
              <p class="text-xs text-muted">
                Публикация: {{ fmtDate(fact.publishedAt) }} · Доступно в IIS: {{ fmtDate(fact.availableAt) }} · {{ fact.locator }}
              </p>
              <a
                :href="fact.sourceUrl"
                target="_blank"
                rel="noopener"
                class="text-xs text-primary hover:underline"
              >{{ fact.title }}</a>
            </div>
            <UButton
              v-if="!data.issuerFundamentals.length"
              to="/macro"
              variant="outline"
            >
              Загрузить первичный отчёт
            </UButton>
          </div>
          <div v-else-if="tab === 'macro'" class="space-y-3 p-5">
            <p class="text-sm text-muted">
              Ставка, курсы, денежная масса и публикации регулятора доступны в отдельном разделе с датами получения и статусами источников.
            </p>
            <UButton to="/macro" variant="outline">
              Макро и источники
            </UButton>
          </div>
          <div v-else-if="tab === 'reports'" class="overflow-x-auto">
            <p class="px-5 py-3 text-xs text-muted">
              Публичные таблицы МСФО Smart-Lab — вторичный источник. Первоисточник — по ссылке «Отчёт»,
              если он доступен. Показатели не включаются в анализ до момента их получения системой.
            </p>
            <table class="w-full text-sm">
              <thead class="text-left text-xs text-muted">
                <tr class="border-b border-default">
                  <th class="px-5 py-2 font-medium">
                    Период
                  </th><th class="px-3 py-2 text-right font-medium">
                    Выручка, млрд ₽
                  </th><th class="px-3 py-2 text-right font-medium">
                    Прибыль, млрд ₽
                  </th><th class="px-3 py-2 text-right font-medium">
                    Долг/EBITDA
                  </th><th class="px-3 py-2 text-right font-medium">
                    ROE
                  </th><th class="px-5 py-2 text-right font-medium">
                    Источник
                  </th>
                </tr>
              </thead>
              <tbody class="num divide-y divide-default">
                <tr v-for="r in data.reports" :key="r.id">
                  <td class="px-5 py-2 font-sans text-highlighted">
                    {{ r.period }} <span class="text-xs text-muted">{{ r.reportType }}</span>
                    <p class="text-xs text-muted">
                      Опубликован {{ fmtDate(r.publishedAt) }}
                    </p>
                    <p class="text-xs text-muted">
                      Получен {{ fmtDate(r.availableAt) }}
                    </p>
                  </td>
                  <td class="px-3 py-2 text-right">
                    {{ fmtNum(r.metrics.revenue === undefined ? null : r.metrics.revenue / 1e9, 1) }}
                  </td>
                  <td class="px-3 py-2 text-right">
                    {{ fmtNum(r.metrics.netIncome === undefined ? null : r.metrics.netIncome / 1e9, 1) }}
                  </td>
                  <td class="px-3 py-2 text-right" :class="(r.metrics.debtToEbitda ?? 0) > 2.5 ? 'text-warning' : ''">
                    {{ fmtNum(r.metrics.debtToEbitda) }}
                  </td>
                  <td class="px-3 py-2 text-right">
                    {{ fmtPct(r.metrics.roe) }}
                  </td>
                  <td class="px-5 py-2 text-right">
                    <a
                      v-if="r.documentUrl"
                      :href="r.documentUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-primary hover:underline"
                    >Отчёт</a>
                    <a
                      v-if="r.url"
                      :href="r.url"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="ml-2 text-primary hover:underline"
                    >Таблица</a>
                    <span v-if="!r.url && !r.documentUrl">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="!data.reports.length" class="px-5 py-4 text-sm text-muted">
              Нет данных отчётности.
            </p>
          </div>
          <ul v-else class="divide-y divide-default">
            <HypothesisRow
              v-for="h in hypotheses ?? []"
              :key="h.id"
              :h="h"
              @preview="preview = $event"
            />
            <li v-if="!hypotheses?.length" class="px-5 py-4 text-sm text-muted">
              По инструменту гипотез ещё не было.
            </li>
          </ul>
        </UCard>
      </template>
      <HypothesisPreview v-model:id="preview" />
    </template>
  </UDashboardPanel>
</template>

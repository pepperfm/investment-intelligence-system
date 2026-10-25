<script setup lang="ts">
const { data, refresh } = await useFetch('/api/portfolio')
const { data: broker } = await useFetch('/api/portfolio/broker')
const action = useAction()
const ticket = ref<null | {
  instrument: {
    id: string
    ticker: string
    name: string
    lotSize: number
  }
  quantity: number
}>(null)
const ticketOpen = ref(false)
const orderTab = ref('open')

const invested = computed(() => (data.value?.positions ?? []).reduce((s, p) => s + p.marketValue, 0))
const pnl = computed(() => data.value ? data.value.equity - data.value.account.initialCash : 0)
const dayChange = computed(() => data.value?.dayStartEquity ? data.value.equity / data.value.dayStartEquity - 1 : null)
const exposurePct = computed(() => data.value ? invested.value / data.value.equity * 100 : 0)

const allocation = computed(() => {
  if (!data.value) {
    return []
  }
  const palette = ['primary', 'info', 'warning', 'secondary', 'error']
  return [
    ...data.value.positions.map((p, i) => ({
      label: p.symbol.split('@')[0],
      value: p.marketValue,
      color: palette[i % palette.length],
    })),
    {
      label: 'Кэш',
      value: data.value.cash,
      color: 'var(--ui-border-accented)',
    },
  ]
})
const sectors = computed(() => {
  const map = new Map<string, number>()
  for (const p of data.value?.positions ?? []) {
    map.set(p.sector, (map.get(p.sector) ?? 0) + p.marketValue)
  }
  return [...map.entries()].map(([sector, value]) => ({
    sector: SECTOR_LABELS[sector] ?? sector,
    value,
  }))
})
const equityCurve = computed(() => [
  ...(data.value?.snapshots ?? []).map(s => ({
    date: fmtDate(s.takenAt),
    equity: s.equity,
  })),
  ...(data.value
    ? [{
        date: 'сейчас',
        equity: data.value.equity,
      }]
    : []),
])
const openOrders = computed(() => (data.value?.orders ?? []).filter(o => ['pending_confirmation', 'working', 'suspended_data_quality'].includes(o.order.status)))
const shownOrders = computed(() => orderTab.value === 'open' ? openOrders.value : data.value?.orders ?? [])

async function act(url: string, message: string) {
  await action.run(() => $fetch<unknown>(url, { method: 'POST' }), message)
  await refresh()
}

async function confirm(id: string) {
  await action.run(() => $fetch<ApiResponse<'/api/orders/:id/confirm', 'post'>>(`/api/orders/${id}/confirm`, { method: 'POST' }), (result) => {
    if (result.status === 'working') {
      return 'Заявка подтверждена заново; исполнение возможно только по следующей новой сессии'
    }
    if (result.status === 'suspended_data_quality') {
      return 'Заявка остаётся приостановленной: проверенные данные пока недоступны'
    }
    if (result.status === 'rejected') {
      return 'Заявка не прошла повторную проверку риска'
    }
    return ORDER_LABELS[result.status] ?? result.status
  })
  await refresh()
}

function sell(p: {
  instrumentId: string
  symbol: string
  lotSize: number
  quantity: number
}) {
  ticket.value = {
    instrument: {
      id: p.instrumentId,
      ticker: p.symbol.split('@')[0]!,
      name: p.symbol,
      lotSize: p.lotSize,
    },
    quantity: p.quantity,
  }
  ticketOpen.value = true
}
useHead({ title: 'Paper-портфель · IIS' })
</script>

<template>
  <UDashboardPanel id="portfolio">
    <template #header>
      <PageNavbar title="Paper-портфель">
        <template #title-extra>
          <UTooltip text="Исполнение симулируется по новой проверенной сессии после подтверждения, с издержками. При проблеме данных заявка приостанавливается.">
            <UBadge color="neutral" icon="i-lucide-flask-round">
              симуляция
            </UBadge>
          </UTooltip>
        </template>
        <template #right>
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-play"
            :loading="action.pending.value"
            @click="act('/api/orders/process', 'Активные заявки обработаны')"
          >
            Обработать заявки
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-camera"
            :loading="action.pending.value"
            @click="act('/api/portfolio/snapshot', 'Снапшот сохранён')"
          >
            Снапшот
          </UButton>
        </template>
      </PageNavbar>
    </template>
    <template #body>
      <UAlert
        v-if="data?.executionReadiness && !data.executionReadiness.ready"
        color="warning"
        title="Paper-исполнение не готово"
        :description="`Нет подтверждённого observed execution source: ${data.executionReadiness.issues.join('; ')}. Дневные исследовательские свечи и историческая реконструкция не исполняют заявки.`"
        class="mb-4"
      />
      <UAlert
        v-if="data?.dataQualityIssues.length"
        color="warning"
        title="Часть цен портфеля не подтверждена"
        :description="`${data.dataQualityIssues.join('; ')}. Для отображения использована себестоимость; заявки и новые снимки заблокированы до проверки цен.`"
      />
      <template v-if="data">
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Equity"
            :value="fmtMoney(data.equity)"
            icon="i-lucide-wallet"
          >
            <DeltaValue :value="pnl / data.account.initialCash" :digits="2" /><span>{{ fmtMoney(pnl) }}</span>
          </StatTile>
          <StatTile
            label="Кэш"
            :value="fmtMoney(data.cash)"
            icon="i-lucide-banknote"
            :hint="`${fmtNum(100 - exposurePct, 1)}% капитала`"
          />
          <StatTile
            label="За день"
            :value="fmtPct(dayChange, 2)"
            icon="i-lucide-calendar-clock"
            :tone="dayChange === null ? 'neutral' : dayChange >= 0 ? 'positive' : 'negative'"
            :hint="`лимит убытка ${data.limits.maxDailyLossPct}%`"
          />
          <StatTile
            label="Открытых заявок"
            :value="String(openOrders.length)"
            icon="i-lucide-receipt"
            :hint="`позиций ${data.positions.length}`"
          />
        </div>

        <div class="grid gap-4 xl:grid-cols-3">
          <UCard class="xl:col-span-2" :ui="{ body: 'space-y-4' }">
            <div class="flex items-center justify-between">
              <p class="section-label">
                Структура капитала
              </p>
              <span class="text-xs text-muted">экспозиция <span class="num text-highlighted">{{ fmtNum(exposurePct, 1) }}%</span> из {{ data.limits.maxTotalExposurePct }}%</span>
            </div>
            <UProgressGroup
              :items="allocation"
              :max="data.equity"
              size="lg"
            />
            <USeparator />
            <div>
              <p class="section-label mb-2">
                Кривая equity
              </p>
              <UChart
                v-if="equityCurve.length > 2"
                type="area"
                curve="monotone"
                :data="equityCurve"
                index="date"
                :categories="[{ key: 'equity', label: 'Equity' }]"
                :height="180"
                :legend="false"
                :format="(v: number) => fmtMoney(v)"
              />
              <UEmpty
                v-else
                icon="i-lucide-chart-spline"
                title="Мало снапшотов"
                description="Делайте снапшоты, чтобы видеть кривую капитала и дневной лимит убытка."
                size="sm"
                variant="naked"
              />
            </div>
          </UCard>
          <UCard>
            <p class="section-label mb-2">
              Сектора
            </p>
            <UChart
              v-if="sectors.length"
              type="donut"
              :data="sectors"
              index="sector"
              :categories="['value']"
              :height="200"
              :thickness="16"
              :format="(v: number) => fmtMoney(v)"
            >
              <template #center>
                <div class="text-center">
                  <p class="num text-lg font-semibold text-highlighted">
                    {{ fmtNum(exposurePct, 0) }}%
                  </p>
                  <p class="text-[11px] text-muted">
                    в бумагах
                  </p>
                </div>
              </template>
            </UChart>
            <UEmpty
              v-else
              icon="i-lucide-pie-chart"
              title="Нет позиций"
              size="sm"
              variant="naked"
            />
            <p class="mt-2 text-xs text-muted">
              Лимит на сектор {{ data.limits.maxSectorPct }}%, на позицию {{ data.limits.maxPositionPct }}%.
            </p>
          </UCard>
        </div>

        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <p class="section-label">
              Позиции
            </p>
          </template>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="text-left text-xs text-muted">
                <tr class="border-b border-default">
                  <th class="px-5 py-2 font-medium">
                    Инструмент
                  </th><th class="px-3 py-2 text-right font-medium">
                    Кол-во
                  </th><th class="px-3 py-2 text-right font-medium">
                    Средняя
                  </th><th class="px-3 py-2 text-right font-medium">
                    Последняя
                  </th><th class="px-3 py-2 text-right font-medium">
                    Стоимость
                  </th><th class="px-3 py-2 text-right font-medium">
                    P&L
                  </th><th class="px-5 py-2" />
                </tr>
              </thead>
              <tbody class="num divide-y divide-default">
                <tr
                  v-for="p in data.positions"
                  :key="p.instrumentId"
                  class="hover:bg-elevated/40"
                >
                  <td class="px-5 py-2.5 font-sans">
                    <NuxtLink :to="`/instruments/${p.instrumentId}`" class="font-semibold text-highlighted hover:underline">
                      {{ p.symbol.split('@')[0] }}
                    </NuxtLink>
                    <span class="ml-2 text-xs text-muted">{{ SECTOR_LABELS[p.sector] ?? p.sector }}</span>
                  </td>
                  <td class="px-3 py-2.5 text-right">
                    {{ p.quantity }}
                  </td>
                  <td class="px-3 py-2.5 text-right">
                    {{ fmtNum(p.avgPrice) }}
                  </td>
                  <td class="px-3 py-2.5 text-right">
                    {{ fmtNum(p.lastPrice) }}
                  </td>
                  <td class="px-3 py-2.5 text-right">
                    {{ fmtMoney(p.marketValue) }}
                  </td>
                  <td class="px-3 py-2.5 text-right">
                    <span :class="p.unrealizedPnl >= 0 ? 'text-success' : 'text-error'">{{ fmtMoney(p.unrealizedPnl) }}</span>
                    <DeltaValue
                      :value="p.lastPrice / p.avgPrice - 1"
                      :arrow="false"
                      class="ml-2 text-xs"
                    />
                  </td>
                  <td class="px-5 py-2.5 text-right">
                    <UButton
                      size="xs"
                      color="neutral"
                      variant="outline"
                      @click="sell(p)"
                    >
                      Продать
                    </UButton>
                  </td>
                </tr>
              </tbody>
            </table>
            <UEmpty
              v-if="!data.positions.length"
              icon="i-lucide-briefcase"
              title="Позиций нет"
              description="Paper-заявки создаются из одобренных гипотез."
              :actions="[{ label: 'К гипотезам', to: '/hypotheses', variant: 'soft' }]"
              size="sm"
              variant="naked"
              class="py-8"
            />
          </div>
        </UCard>

        <UCard :ui="{ header: 'p-0 sm:px-2 border-b border-default', body: 'p-0 sm:p-0' }">
          <template #header>
            <UTabs
              v-model="orderTab"
              :items="[{ label: 'Активные заявки', value: 'open', badge: openOrders.length ? String(openOrders.length) : undefined }, { label: 'Все заявки', value: 'all' }, { label: 'Сделки', value: 'fills', badge: String(data.executions.length) }]"
              :content="false"
              variant="link"
              size="sm"
              class="-mb-px"
            />
          </template>
          <ul v-if="orderTab !== 'fills'" class="divide-y divide-default">
            <li
              v-for="{ order: o, symbol } in shownOrders"
              :key="o.id"
              class="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm sm:px-5"
            >
              <UIcon
                :name="o.side === 'buy' ? 'i-lucide-arrow-down-to-line' : 'i-lucide-arrow-up-from-line'"
                class="size-4"
                :class="o.side === 'buy' ? 'text-success' : 'text-error'"
              />
              <span class="font-medium text-highlighted">{{ o.side === 'buy' ? 'Покупка' : 'Продажа' }} {{ symbol.split('@')[0] }}</span>
              <span class="num">× {{ o.quantity }}</span>
              <span class="text-xs text-muted">{{ o.type === 'limit' ? `лимит ${fmtNum(o.limitPrice)}` : 'рыночная' }} · {{ fmtDate(o.createdAt, true) }}</span>
              <UBadge :color="o.status === 'suspended_data_quality' ? 'warning' : ORDER_COLORS[o.status] ?? 'neutral'" size="sm">
                {{ o.status === 'suspended_data_quality' ? 'Приостановлена: качество данных' : ORDER_LABELS[o.status] ?? o.status }}
              </UBadge>
              <UTooltip v-if="o.rejectReason" :text="o.rejectReason">
                <UIcon name="i-lucide-info" class="size-4 text-error" />
              </UTooltip>
              <NuxtLink
                v-if="o.hypothesisId"
                :to="`/hypotheses/${o.hypothesisId}`"
                class="text-xs text-muted hover:text-primary"
              >
                гипотеза
              </NuxtLink>
              <span class="ml-auto flex gap-1.5">
                <UButton
                  v-if="o.status === 'pending_confirmation' || o.status === 'suspended_data_quality'"
                  size="xs"
                  color="warning"
                  icon="i-lucide-shield-check"
                  @click="confirm(o.id)"
                >{{ o.status === 'suspended_data_quality' ? 'Проверить и подтвердить заново' : 'Подтвердить' }}</UButton>
                <UButton
                  v-if="['pending_confirmation', 'working', 'suspended_data_quality'].includes(o.status)"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  @click="act(`/api/orders/${o.id}/cancel`, 'Заявка отменена')"
                >Отменить</UButton>
              </span>
            </li>
            <li v-if="!shownOrders.length" class="px-5 py-4 text-sm text-muted">
              {{ orderTab === 'open' ? 'Активных заявок нет.' : 'Заявок ещё не было.' }}
            </li>
          </ul>
          <ul v-else class="divide-y divide-default">
            <li
              v-for="{ execution: e, symbol } in data.executions"
              :key="e.id"
              class="flex items-center gap-3 px-4 py-2.5 text-sm sm:px-5"
            >
              <span class="w-20 font-medium">{{ symbol.split('@')[0] }}</span>
              <span :class="e.side === 'buy' ? 'text-success' : 'text-error'">{{ e.side === 'buy' ? 'покупка' : 'продажа' }}</span>
              <span class="num">{{ e.quantity }} × {{ fmtNum(e.price) }}</span>
              <span class="num text-xs text-muted">комиссия {{ fmtMoney(e.commission) }}</span>
              <span class="ml-auto text-xs text-muted">{{ fmtDate(e.executedAt, true) }}</span>
            </li>
            <li v-if="!data.executions.length" class="px-5 py-4 text-sm text-muted">
              Сделок нет.
            </li>
          </ul>
        </UCard>

        <UCollapsible>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-landmark"
            trailing-icon="i-lucide-chevron-down"
            :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform' }"
          >
            Брокерский счёт Finam (только чтение)
          </UButton>
          <template #content>
            <UCard class="mt-2">
              <div v-if="broker?.configured && broker.account" class="space-y-1 text-sm">
                <p>Счёт <span class="num">{{ broker.account.externalId }}</span> · equity {{ fmtMoney(broker.account.equity) }} · кэш {{ fmtMoney(broker.account.cash) }}</p>
                <p
                  v-for="p in broker.account.positions"
                  :key="p.symbol"
                  class="num text-muted"
                >
                  {{ p.symbol }} × {{ p.quantity }} @ {{ fmtNum(p.avgPrice) }} (тек. {{ fmtNum(p.lastPrice) }})
                </p>
              </div>
              <p v-else class="text-sm text-muted">
                Не подключён. Задайте <code class="num text-xs">NUXT_MARKET_PROVIDER=finam</code>, <code class="num text-xs">NUXT_FINAM_READ_SECRET</code> и <code class="num text-xs">NUXT_FINAM_ACCOUNT_ID</code>.
              </p>
            </UCard>
          </template>
        </UCollapsible>
      </template>
      <OrderTicket
        v-if="ticket"
        v-model:open="ticketOpen"
        :instrument="ticket.instrument"
        default-side="sell"
        :default-quantity="ticket.quantity"
        @created="refresh"
      />
    </template>
  </UDashboardPanel>
</template>

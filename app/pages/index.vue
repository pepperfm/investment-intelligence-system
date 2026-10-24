<script setup lang="ts">
const { data: status, refresh: refreshStatus } = useSystemStatus()
const { data: hypotheses } = await useFetch('/api/hypotheses')
const { data: runs } = await useFetch('/api/runs')
const { data: portfolio } = await useFetch('/api/portfolio')
const { data: overview } = await useFetch('/api/instruments/overview')
const sync = useAction()
const preview = ref<string | null>(null)

const toDecide = computed(() => (hypotheses.value ?? []).filter(h => h.status === 'ready_for_user' || h.status === 'needs_review').slice(0, 8))
const index = computed(() => overview.value?.find(i => i.kind === 'index'))
const setups = computed(() => (overview.value ?? []).flatMap(i => i.signals.filter(s => s.setup).map(s => ({
  ...s,
  id: i.id,
  ticker: i.ticker,
  name: i.name,
  change1d: i.change1d,
}))))
const pnl = computed(() => portfolio.value ? portfolio.value.equity - portfolio.value.account.initialCash : 0)
const equityCurve = computed(() => (portfolio.value?.snapshots ?? []).map(s => s.equity).concat(portfolio.value ? [portfolio.value.equity] : []))

async function syncData() {
  await sync.run(() => $fetch<ApiResponse<'/api/instruments/sync', 'post'>>('/api/instruments/sync', { method: 'POST' }), r => `Обновлено: ${r.instruments} инструментов, ${fmtNum(r.candles)} свечей`)
  await refreshStatus()
  await refreshNuxtData()
}
useHead({ title: 'Обзор · IIS' })
</script>

<template>
  <UDashboardPanel id="home">
    <template #header>
      <PageNavbar title="Обзор">
        <template #right>
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            :loading="sync.pending.value"
            class="hidden sm:inline-flex"
            @click="syncData"
          >
            Обновить данные
          </UButton>
          <UButton icon="i-lucide-flask-conical" to="/research">
            Исследовать
          </UButton>
        </template>
      </PageNavbar>
    </template>
    <template #body>
      <UEmpty
        v-if="status && !status.counts.candles"
        icon="i-lucide-database"
        title="Данных пока нет"
        description="Загрузите инструменты, котировки и события. Анализ никогда не запускается автоматически — только по вашей команде."
        :actions="[{ label: 'Загрузить данные', icon: 'i-lucide-download', loading: sync.pending.value, onClick: syncData }]"
        variant="naked"
        class="py-16"
      />
      <template v-else>
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Paper equity"
            :value="fmtMoney(portfolio?.equity)"
            icon="i-lucide-wallet"
            to="/portfolio"
          >
            <DeltaValue :value="portfolio ? pnl / portfolio.account.initialCash : null" :digits="2" />
            <span>с начала</span>
          </StatTile>
          <StatTile
            label="К решению"
            :value="String(toDecide.length)"
            icon="i-lucide-inbox"
            to="/hypotheses"
            :hint="`${status?.byStatus.ready_for_user ?? 0} готовы · ${status?.byStatus.needs_review ?? 0} на разборе`"
          />
          <StatTile
            label="Сетапы сейчас"
            :value="String(setups.length)"
            icon="i-lucide-radar"
            to="/instruments"
            hint="по активным правилам, без ИИ"
          />
          <StatTile
            :label="index?.name ?? 'Индекс'"
            :value="fmtNum(index?.last)"
            icon="i-lucide-gauge"
            :to="index ? `/instruments/${index.id}` : undefined"
          >
            <DeltaValue :value="index?.change1d" :digits="2" />
            <span>день ·</span>
            <DeltaValue :value="index?.change20d" :arrow="false" />
            <span>20д</span>
          </StatTile>
        </div>

        <div class="grid gap-4 xl:grid-cols-3">
          <UCard class="xl:col-span-2" :ui="{ body: 'p-0 sm:p-0' }">
            <template #header>
              <div class="flex items-center justify-between">
                <div>
                  <h2 class="font-semibold text-highlighted">
                    Очередь решений
                  </h2>
                  <p class="text-xs text-muted">
                    Только гипотезы, прошедшие независимого критика
                  </p>
                </div>
                <UButton
                  to="/hypotheses"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  trailing-icon="i-lucide-arrow-right"
                >
                  Все
                </UButton>
              </div>
            </template>
            <ul v-if="toDecide.length" class="divide-y divide-default">
              <HypothesisRow
                v-for="h in toDecide"
                :key="h.id"
                :h="h"
                @preview="preview = $event"
              />
            </ul>
            <UEmpty
              v-else
              icon="i-lucide-inbox"
              title="Очередь пуста"
              description="Запустите исследование — гипотезы появятся здесь после проверки критиком."
              size="sm"
              variant="naked"
              class="py-10"
            />
          </UCard>

          <div class="space-y-4">
            <UCard :ui="{ body: 'space-y-2' }">
              <div class="flex items-baseline justify-between">
                <p class="section-label">
                  Paper equity
                </p>
                <span class="num text-xs text-muted">{{ equityCurve.length - 1 }} снапш.</span>
              </div>
              <SparkLine
                v-if="equityCurve.length > 2"
                :values="equityCurve"
                :height="64"
              />
              <p v-else class="text-xs text-muted">
                Кривая появится после нескольких снапшотов портфеля.
              </p>
              <div class="flex justify-between text-xs">
                <span class="text-muted">Кэш</span><span class="num">{{ fmtMoney(portfolio?.cash) }}</span>
              </div>
              <div class="flex justify-between text-xs">
                <span class="text-muted">Позиций</span><span class="num">{{ portfolio?.positions.length ?? 0 }}</span>
              </div>
            </UCard>
            <UCard :ui="{ body: 'p-0 sm:p-0' }">
              <template #header>
                <div class="flex items-center justify-between">
                  <p class="section-label">
                    Сетапы по правилам
                  </p>
                  <UButton
                    to="/research"
                    size="xs"
                    variant="soft"
                  >
                    Исследовать
                  </UButton>
                </div>
              </template>
              <ul class="max-h-64 divide-y divide-default overflow-y-auto">
                <li
                  v-for="s in setups"
                  :key="s.id + s.strategy"
                  class="flex items-center gap-2 px-4 py-2 text-sm"
                >
                  <NuxtLink :to="`/instruments/${s.id}`" class="w-14 font-medium text-highlighted hover:underline">
                    {{ s.ticker }}
                  </NuxtLink>
                  <UBadge color="neutral" size="sm">
                    {{ STRATEGY_LABELS[s.strategy] }} v{{ s.version }}
                  </UBadge>
                  <span class="text-xs text-muted">{{ s.setupType }}</span>
                  <DeltaValue :value="s.change1d" class="ml-auto text-xs" />
                </li>
                <li v-if="!setups.length" class="px-4 py-3 text-xs text-muted">
                  Сейчас сетапов нет.
                </li>
              </ul>
            </UCard>
          </div>
        </div>

        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="font-semibold text-highlighted">
                Последние исследования
              </h2>
              <UButton
                to="/research"
                color="neutral"
                variant="ghost"
                size="sm"
                trailing-icon="i-lucide-arrow-right"
              >
                История
              </UButton>
            </div>
          </template>
          <ul class="divide-y divide-default">
            <RunRow
              v-for="r in (runs ?? []).slice(0, 5)"
              :key="r.id"
              :run="r"
            />
            <li v-if="!runs?.length" class="px-5 py-4 text-sm text-muted">
              Исследований ещё не было.
            </li>
          </ul>
        </UCard>
      </template>
      <HypothesisPreview v-model:id="preview" />
    </template>
  </UDashboardPanel>
</template>

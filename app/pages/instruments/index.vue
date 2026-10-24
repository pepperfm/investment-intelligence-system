<script setup lang="ts">
const { data, refresh } = await useFetch('/api/instruments/overview')
const sync = useAction()
const sourceErrors = ref<string[]>([])
const q = ref('')
const filter = ref<'all' | 'setup'>('all')
const sort = ref<'ticker' | 'change1d' | 'change20d'>('ticker')

const items = computed(() => (data.value ?? [])
  .filter(i => !q.value || `${i.ticker} ${i.name}`.toLowerCase().includes(q.value.toLowerCase()))
  .filter(i => filter.value === 'all' || i.signals.some(s => s.setup))
  .sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'index' ? -1 : 1
    }
    return sort.value === 'ticker' ? a.ticker.localeCompare(b.ticker) : (b[sort.value] ?? 0) - (a[sort.value] ?? 0)
  }))

async function syncData() {
  const result = await sync.run(() => $fetch<ApiResponse<'/api/instruments/sync', 'post'>>('/api/instruments/sync', { method: 'POST' }), r => `Свечи: ${fmtNum(r.candles)} · новости: ${r.events} · отчёты: ${r.reports}`)
  sourceErrors.value = result?.sourceErrors ?? []
  await refresh()
}
useHead({ title: 'Инструменты · IIS' })
</script>

<template>
  <UDashboardPanel id="instruments">
    <template #header>
      <PageNavbar title="Инструменты" :badge="data?.length">
        <template #right>
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            :loading="sync.pending.value"
            @click="syncData"
          >
            Обновить
          </UButton>
        </template>
      </PageNavbar>
      <UDashboardToolbar>
        <template #left>
          <UInput
            v-model="q"
            icon="i-lucide-search"
            placeholder="Тикер или название"
            size="sm"
            class="w-52"
          />
          <UFieldGroup size="sm">
            <UButton
              :color="filter === 'all' ? 'primary' : 'neutral'"
              :variant="filter === 'all' ? 'subtle' : 'outline'"
              @click="filter = 'all'"
            >
              Все
            </UButton>
            <UButton
              :color="filter === 'setup' ? 'primary' : 'neutral'"
              :variant="filter === 'setup' ? 'subtle' : 'outline'"
              icon="i-lucide-radar"
              @click="filter = 'setup'"
            >
              С сетапом
            </UButton>
          </UFieldGroup>
        </template>
        <template #right>
          <USelect
            v-model="sort"
            :items="[{ label: 'По тикеру', value: 'ticker' }, { label: 'Рост за день', value: 'change1d' }, { label: 'Рост за 20 дней', value: 'change20d' }]"
            size="sm"
            icon="i-lucide-arrow-down-wide-narrow"
            class="w-44"
          />
        </template>
      </UDashboardToolbar>
    </template>
    <template #body>
      <UAlert
        v-if="sourceErrors.length"
        color="warning"
        title="Часть источников недоступна"
        :description="sourceErrors.join('; ')"
      />
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        <NuxtLink
          v-for="i in items"
          :key="i.id"
          :to="`/instruments/${i.id}`"
          class="group flex flex-col gap-2 rounded-xl bg-default p-4 ring ring-default transition hover:ring-accented"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="flex items-center gap-1.5 font-semibold text-highlighted">
                {{ i.ticker }}
                <UBadge
                  v-if="i.kind === 'index'"
                  size="sm"
                  color="neutral"
                >
                  индекс
                </UBadge>
              </p>
              <p class="truncate text-xs text-muted">
                {{ i.name }} · {{ SECTOR_LABELS[i.sector] ?? i.sector }}
              </p>
            </div>
            <div class="text-right">
              <p class="num text-sm font-semibold text-highlighted">
                {{ fmtNum(i.last) }}
              </p>
              <DeltaValue
                :value="i.change1d"
                :digits="2"
                class="text-xs"
              />
            </div>
          </div>
          <SparkLine :values="i.spark" :height="44" />
          <div class="flex items-center justify-between gap-2">
            <div class="flex flex-wrap gap-1">
              <SignalPill
                v-for="s in i.signals"
                :key="s.strategy"
                :signal="s"
              />
            </div>
            <span class="text-[11px] text-muted">20д <DeltaValue :value="i.change20d" :arrow="false" /></span>
          </div>
        </NuxtLink>
      </div>
      <UEmpty
        v-if="!items.length"
        icon="i-lucide-search-x"
        title="Ничего не найдено"
        :description="data?.length ? 'Измените фильтр.' : 'Загрузите инструменты кнопкой «Обновить».'"
        variant="naked"
      />
    </template>
  </UDashboardPanel>
</template>

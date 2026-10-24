<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })
const toast = useToast()
const { data: instruments } = useFetch('/api/instruments', {
  key: 'search-instruments',
  lazy: true,
  server: false,
})
const { data: hypotheses } = useFetch('/api/hypotheses', {
  key: 'search-hypotheses',
  lazy: true,
  server: false,
})

const groups = computed(() => [{
  id: 'actions',
  label: 'Действия',
  items: [{
    label: 'Новое исследование',
    icon: 'i-lucide-flask-conical',
    to: '/research',
    onSelect: () => {
      open.value = false
    },
  }, {
    label: 'Обновить котировки и события',
    icon: 'i-lucide-refresh-cw',
    onSelect: async () => {
      open.value = false
      const r = await $fetch<ApiResponse<'/api/instruments/sync', 'post'>>('/api/instruments/sync', { method: 'POST' })
      toast.add({
        title: `Свечи: ${r.candles} · новости: ${r.events} · отчёты: ${r.reports}`,
        description: r.sourceErrors.length ? r.sourceErrors.join('; ') : undefined,
        color: r.sourceErrors.length ? 'warning' : 'success',
      })
    },
  }, {
    label: 'Оценить созревшие гипотезы',
    icon: 'i-lucide-target',
    to: '/evaluations',
    onSelect: () => {
      open.value = false
    },
  }],
}, {
  id: 'pages',
  label: 'Разделы',
  items: NAV_ITEMS.map(i => ({
    label: i.label,
    icon: i.icon,
    to: i.to,
    onSelect: () => {
      open.value = false
    },
  })),
}, {
  id: 'instruments',
  label: 'Инструменты',
  items: (instruments.value ?? []).map(i => ({
    label: i.ticker,
    suffix: i.name,
    icon: i.kind === 'index' ? 'i-lucide-gauge' : 'i-lucide-candlestick-chart',
    to: `/instruments/${i.id}`,
    onSelect: () => {
      open.value = false
    },
  })),
}, {
  id: 'hypotheses',
  label: 'Гипотезы',
  items: (hypotheses.value ?? []).slice(0, 50).map(h => ({
    label: `${h.symbol.split('@')[0]} · ${STRATEGY_LABELS[h.strategyId]}`,
    suffix: `${STATUS_LABELS[h.status]} · ${fmtDate(h.createdAt)}`,
    icon: 'i-lucide-lightbulb',
    to: `/hypotheses/${h.id}`,
    onSelect: () => {
      open.value = false
    },
  })),
}])
</script>

<template>
  <UDashboardSearch
    v-model:open="open"
    :groups="groups"
    placeholder="Инструмент, гипотеза, раздел или действие…"
    :color-mode="true"
  />
</template>

<script setup lang="ts">
import { h as render } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import { exportHypotheses, type HypothesisExport, type HypothesisExportFormat } from '~/utils/hypothesis-export'
import { UCheckbox, StatusBadge, VerdictBadge, LevelsBar, UBadge, UIcon, UTooltip } from '#components'

const route = useRoute()
const { data, status: loadStatus } = await useFetch('/api/hypotheses')
type Row = NonNullable<typeof data.value>[number]

const GROUPS = {
  decide: ['ready_for_user', 'needs_review'],
  critic: ['awaiting_critic', 'draft'],
  decided: ['user_approved', 'user_rejected', 'watching', 'closed'],
  evaluated: ['evaluated'],
} as const
type Group = keyof typeof GROUPS | 'all'

const tab = ref<Group>((route.query.tab as Group) ?? 'decide')
const strategy = ref<string>('all')
const direction = ref<string>('all')
const q = ref('')
const preview = ref<string | null>(null)
const selected = ref<string[]>([])
const copyFormat = ref<HypothesisExportFormat>('md')
const copyAction = useAction()
watch([tab, strategy, direction, q], () => {
  selected.value = []
})
const selectedRows = computed(() => rows.value.filter(row => selected.value.includes(row.id)))
const selectionState = computed(() => {
  if (!selectedRows.value.length) {
    return false
  }
  if (selectedRows.value.length === rows.value.length) {
    return true
  }
  return 'indeterminate' as const
})
function toggleRow(id: string, checked: boolean) {
  selected.value = checked ? [...new Set([...selected.value, id])] : selected.value.filter(value => value !== id)
}
async function copySelected() {
  const ids = selectedRows.value.map(row => row.id)
  const format = copyFormat.value
  if (!ids.length) {
    return
  }
  await copyAction.run(async () => {
    const hypotheses = await Promise.all(ids.map(id => $fetch<HypothesisExport>(`/api/hypotheses/${id}`)))
    await navigator.clipboard.writeText(exportHypotheses(hypotheses, format))
    return hypotheses.length
  }, count => `Скопировано гипотез: ${count} · ${format === 'md' ? 'Markdown' : 'TXT'}`)
}

const count = (group: Group) => (data.value ?? []).filter(h => group === 'all' || (GROUPS[group] as readonly string[]).includes(h.status)).length
const tabs = computed(() => [
  {
    label: 'К решению',
    value: 'decide',
    badge: count('decide') || undefined,
    icon: 'i-lucide-inbox',
  },
  {
    label: 'Ждут критика',
    value: 'critic',
    badge: count('critic') || undefined,
    icon: 'i-lucide-hourglass',
  },
  {
    label: 'Решённые',
    value: 'decided',
    icon: 'i-lucide-check-check',
  },
  {
    label: 'Оценённые',
    value: 'evaluated',
    icon: 'i-lucide-target',
  },
  {
    label: 'Все',
    value: 'all',
  },
])
const rows = computed(() => (data.value ?? []).filter(h =>
  (tab.value === 'all' || (GROUPS[tab.value] as readonly string[]).includes(h.status))
  && (strategy.value === 'all' || h.strategyId === strategy.value)
  && (direction.value === 'all' || h.direction === direction.value)
  && (!q.value || `${h.symbol} ${h.name} ${h.thesis}`.toLowerCase().includes(q.value.toLowerCase())),
))

const columns: TableColumn<Row>[] = [
  {
    id: 'select',
    header: () => render(UCheckbox, {
      'aria-label': 'Выбрать все видимые гипотезы',
      'modelValue': selectionState.value,
      'disabled': rows.value.length === 0,
      'onUpdate:modelValue': (value: unknown) => {
        selected.value = value === true ? rows.value.map(row => row.id) : []
      },
    }),
    cell: ({ row }) => render('div', { onClick: (event: Event) => event.stopPropagation() }, [render(UCheckbox, {
      'aria-label': `Выбрать ${row.original.symbol} ${STRATEGY_LABELS[row.original.strategyId]}`,
      'modelValue': selected.value.includes(row.original.id),
      'onUpdate:modelValue': (value: unknown) => toggleRow(row.original.id, value === true),
    })]),
  },
  {
    accessorKey: 'symbol',
    header: 'Инструмент',
    cell: ({ row }) => render('div', { class: 'min-w-24' }, [
      render('p', { class: 'font-semibold text-highlighted' }, row.original.symbol.split('@')[0]),
      render('p', { class: 'text-[11px] text-muted truncate max-w-36' }, row.original.name),
    ]),
  },
  {
    accessorKey: 'strategyId',
    header: 'Стратегия',
    cell: ({ row }) => render(UBadge, {
      color: 'neutral',
      size: 'sm',
    }, () => STRATEGY_LABELS[row.original.strategyId]),
  },
  {
    id: 'levels',
    header: 'Стоп · вход · цель',
    cell: ({ row }) => row.original.direction === 'long'
      ? render('div', { class: 'w-36' }, [render(LevelsBar, {
          entry: row.original.entry.price,
          stop: row.original.exit.stopLoss,
          target: row.original.exit.takeProfit,
          compact: true,
        })])
      : render(UBadge, {
          color: 'neutral',
          variant: 'soft',
          size: 'sm',
        }, () => 'не покупать'),
  },
  {
    id: 'rr',
    header: 'R/R',
    cell: ({ row }) => {
      const risk = row.original.entry.price - row.original.exit.stopLoss
      return render('span', { class: 'num text-xs' }, row.original.direction === 'long' && risk > 0 ? ((row.original.exit.takeProfit - row.original.entry.price) / risk).toFixed(2) : '—')
    },
  },
  {
    accessorKey: 'criticVerdict',
    header: 'Критик',
    cell: ({ row }) => render('div', { class: 'flex items-center gap-1.5' }, [
      render(VerdictBadge, { verdict: row.original.criticVerdict }),
      row.original.validationOk === false
        ? render(UTooltip, { text: 'Кодовая валидация не пройдена' }, () => render(UIcon, {
            name: 'i-lucide-octagon-alert',
            class: 'size-4 text-error',
          }))
        : null,
    ]),
  },
  {
    accessorKey: 'status',
    header: 'Статус',
    cell: ({ row }) => render(StatusBadge, { status: row.original.status }),
  },
  {
    accessorKey: 'confidence',
    header: 'Увер.',
    cell: ({ row }) => render('span', { class: 'num text-xs text-muted' }, fmtPct(row.original.confidence, 0)),
  },
  {
    accessorKey: 'createdAt',
    header: 'Создана',
    cell: ({ row }) => render('span', { class: 'text-xs text-muted whitespace-nowrap' }, fmtDate(row.original.createdAt)),
  },
]
function onSelect(_e: Event, row: { original: Row }) {
  preview.value = row.original.id
}
useHead({ title: 'Гипотезы · IIS' })
</script>

<template>
  <UDashboardPanel id="hypotheses">
    <template #header>
      <PageNavbar title="Гипотезы" :badge="data?.length" />
      <UDashboardToolbar>
        <template #left>
          <UTabs
            v-model="tab"
            :items="tabs"
            :content="false"
            variant="link"
            size="sm"
            class="-mb-px"
          />
        </template>
        <template #right>
          <UInput
            v-model="q"
            icon="i-lucide-search"
            placeholder="Тикер или тезис"
            size="sm"
            class="w-44"
          />
          <USelect
            v-model="strategy"
            :items="[{ label: 'Все стратегии', value: 'all' }, { label: 'Swing', value: 'swing' }, { label: 'Position', value: 'position' }]"
            size="sm"
            class="w-36"
          />
          <USelect
            v-model="direction"
            :items="[{ label: 'Любое', value: 'all' }, { label: 'Long', value: 'long' }, { label: 'Не покупать', value: 'no_trade' }]"
            size="sm"
            class="w-32"
          />
        </template>
      </UDashboardToolbar>
    </template>
    <template #body>
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <span class="text-sm text-muted">Выбрано: {{ selectedRows.length }}</span>
        <USelect
          v-model="copyFormat"
          :items="[{ label: 'Markdown', value: 'md' }, { label: 'TXT', value: 'txt' }]"
          aria-label="Формат копирования"
          size="sm"
          class="w-32"
        />
        <UButton
          icon="i-lucide-copy"
          size="sm"
          :disabled="!selectedRows.length"
          :loading="copyAction.pending.value"
          @click="copySelected"
        >
          Скопировать выбранные
        </UButton>
        <UButton
          v-if="selectedRows.length"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="selected = []"
        >
          Снять выбор
        </UButton>
      </div>
      <UTable
        :data="rows"
        :columns="columns"
        :loading="loadStatus === 'pending'"
        sticky="header"
        :on-select="onSelect"
        :ui="{ tr: 'cursor-pointer hover:bg-elevated/40 transition-colors', base: 'border-separate border-spacing-0' }"
        class="-mx-4 sm:-mx-6"
      >
        <template #empty>
          <UEmpty
            icon="i-lucide-lightbulb-off"
            title="Нет гипотез в этом разделе"
            description="Измените фильтры или запустите новое исследование."
            :actions="[{ label: 'Исследовать', icon: 'i-lucide-flask-conical', to: '/research' }]"
            variant="naked"
          />
        </template>
      </UTable>
      <HypothesisPreview v-model:id="preview" />
    </template>
  </UDashboardPanel>
</template>

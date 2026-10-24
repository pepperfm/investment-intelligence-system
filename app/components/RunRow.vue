<script setup lang="ts">
const props = defineProps<{
  run: {
    id: string
    status: string
    kind: string
    strategies: string[]
    instrumentIds: string[]
    asOf: string
    createdAt: string
    startedAt: string | null
    finishedAt: string | null
    provider: string
    criticProvider: string
    rulesVersions: Record<string, number>
    summary: Record<string, unknown> | null
  }
}>()

const STATUS = {
  completed: {
    icon: 'i-lucide-circle-check',
    class: 'text-success',
  },
  failed: {
    icon: 'i-lucide-circle-x',
    class: 'text-error',
  },
  running: {
    icon: 'i-lucide-loader-circle',
    class: 'text-primary animate-spin',
  },
  queued: {
    icon: 'i-lucide-clock',
    class: 'text-warning',
  },
} as Record<string, {
  icon: string
  class: string
}>

const duration = computed(() => {
  if (!props.run.startedAt || !props.run.finishedAt) {
    return null
  }
  const s = Math.round((new Date(props.run.finishedAt).getTime() - new Date(props.run.startedAt).getTime()) / 1000)
  return s >= 60 ? `${Math.floor(s / 60)} мин ${s % 60} с` : `${s} с`
})
const summary = computed(() => props.run.summary as null | {
  hypotheses?: unknown[]
  screenedOut?: unknown[]
  failures?: unknown[]
})
const historical = computed(() => Date.now() - new Date(props.run.asOf).getTime() > 2 * 86_400_000)
</script>

<template>
  <li>
    <NuxtLink :to="`/research/${run.id}`" class="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-elevated/50 sm:px-5">
      <UIcon
        :name="STATUS[run.status]?.icon ?? 'i-lucide-circle'"
        class="size-4 shrink-0"
        :class="STATUS[run.status]?.class"
      />
      <div class="min-w-0 flex-1">
        <p class="flex flex-wrap items-center gap-x-2 text-sm">
          <span class="font-medium text-highlighted">{{ run.kind === 'why_not_buy' ? 'Почему не покупать' : 'Исследование' }}</span>
          <span class="text-muted">{{ run.strategies.map(s => `${STRATEGY_LABELS[s]} v${run.rulesVersions[s] ?? '?'}`).join(' + ') }}</span>
          <UBadge
            v-if="historical"
            size="sm"
            color="neutral"
          >
            на {{ fmtDate(run.asOf) }}
          </UBadge>
        </p>
        <p class="text-xs text-muted">
          {{ fmtDate(run.createdAt, true) }} · {{ run.instrumentIds.length }} инстр. · {{ run.provider }}/{{ run.criticProvider }}<template v-if="duration">
            · {{ duration }}
          </template>
        </p>
      </div>
      <div v-if="summary" class="hidden items-center gap-3 text-xs sm:flex">
        <UTooltip text="Гипотез">
          <span class="num flex items-center gap-1"><UIcon name="i-lucide-lightbulb" class="size-3.5 text-dimmed" />{{ summary.hypotheses?.length ?? 0 }}</span>
        </UTooltip>
        <UTooltip text="Отсеяно скринингом">
          <span class="num flex items-center gap-1 text-muted"><UIcon name="i-lucide-filter" class="size-3.5 text-dimmed" />{{ summary.screenedOut?.length ?? 0 }}</span>
        </UTooltip>
        <UTooltip v-if="summary.failures?.length" text="Ошибок">
          <span class="num flex items-center gap-1 text-error"><UIcon name="i-lucide-triangle-alert" class="size-3.5" />{{ summary.failures.length }}</span>
        </UTooltip>
      </div>
      <UIcon name="i-lucide-chevron-right" class="size-4 text-dimmed" />
    </NuxtLink>
  </li>
</template>

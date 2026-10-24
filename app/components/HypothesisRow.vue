<script setup lang="ts">
import type { EntryScenario, ExitScenario } from '#shared/types/investment'

defineProps<{
  h: {
    id: string
    symbol: string
    name: string
    strategyId: string
    direction: string
    status: string
    criticVerdict: string | null
    thesis: string
    confidence: number
    createdAt: string
    entry: EntryScenario
    exit: ExitScenario
  }
}>()
defineEmits<{ preview: [id: string] }>()
</script>

<template>
  <li class="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-elevated/50 sm:px-5">
    <div class="w-24 shrink-0 sm:w-28">
      <NuxtLink :to="`/hypotheses/${h.id}`" class="font-semibold text-highlighted hover:underline">
        {{ h.symbol.split('@')[0] }}
      </NuxtLink>
      <p class="truncate text-[11px] text-muted">
        {{ STRATEGY_LABELS[h.strategyId] }} · {{ fmtDate(h.createdAt) }}
      </p>
    </div>
    <div class="hidden w-40 shrink-0 md:block">
      <LevelsBar
        v-if="h.direction === 'long'"
        :entry="h.entry.price"
        :stop="h.exit.stopLoss"
        :target="h.exit.takeProfit"
        compact
      />
      <UBadge
        v-else
        color="neutral"
        variant="soft"
        size="sm"
      >
        не покупать
      </UBadge>
    </div>
    <UPopover
      mode="hover"
      :open-delay="0"
      :content="{ side: 'top', align: 'start' }"
    >
      <p class="min-w-0 flex-1 cursor-default truncate text-sm text-toned">
        {{ h.thesis }}
      </p>
      <template #content>
        <div class="max-w-md space-y-2 p-3 text-sm">
          <p>{{ h.thesis }}</p>
          <div class="flex items-center gap-2 text-xs text-muted">
            Уверенность аналитика <span class="num text-highlighted">{{ fmtPct(h.confidence, 0) }}</span>
          </div>
        </div>
      </template>
    </UPopover>
    <VerdictBadge :verdict="h.criticVerdict" class="hidden sm:inline-flex" />
    <StatusBadge :status="h.status" />
    <UButton
      icon="i-lucide-panel-right-open"
      color="neutral"
      variant="ghost"
      size="xs"
      square
      class="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      aria-label="Быстрый просмотр"
      @click="$emit('preview', h.id)"
    />
  </li>
</template>

<script setup lang="ts">
defineProps<{
  signal: {
    strategy: string
    version: number
    setup: boolean
    setupType: string
    reasons: string[]
    failures: string[]
    rewardRisk?: number | null
  }
}>()
</script>

<template>
  <UPopover
    mode="hover"
    :open-delay="0"
    :content="{ side: 'top' }"
  >
    <button
      type="button"
      class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ring ring-inset transition-colors"
      :class="signal.setup ? 'bg-primary/10 text-primary ring-primary/30' : 'bg-elevated/50 text-muted ring-default'"
      @click.prevent
    >
      <span class="size-1.5 rounded-full" :class="signal.setup ? 'bg-primary' : 'bg-(--ui-text-dimmed)'" />
      {{ STRATEGY_LABELS[signal.strategy] }}
      <span v-if="signal.setup" class="opacity-80">· {{ signal.setupType }}</span>
    </button>
    <template #content>
      <div class="w-72 space-y-2 p-3 text-xs">
        <p class="section-label">
          {{ STRATEGY_LABELS[signal.strategy] }} v{{ signal.version }} · {{ signal.setup ? 'есть сетап' : 'нет сетапа' }}
        </p>
        <ul class="space-y-1">
          <li
            v-for="r in signal.reasons"
            :key="r"
            class="flex gap-1.5"
          >
            <UIcon name="i-lucide-check" class="mt-0.5 size-3.5 shrink-0 text-success" />{{ r }}
          </li>
          <li
            v-for="f in signal.failures"
            :key="f"
            class="flex gap-1.5"
          >
            <UIcon name="i-lucide-x" class="mt-0.5 size-3.5 shrink-0 text-error" />{{ f }}
          </li>
        </ul>
        <p class="text-[11px] text-dimmed">
          Детерминированный скрининг кода, не рекомендация.
        </p>
      </div>
    </template>
  </UPopover>
</template>

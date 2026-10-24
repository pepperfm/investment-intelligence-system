<script setup lang="ts">
const props = defineProps<{
  entry: number
  stop: number
  target: number
  /** Latest price, shown as a marker when it differs from the entry. */
  last?: number | null
  compact?: boolean
}>()

const view = computed(() => {
  const lo = Math.min(props.stop, props.last ?? props.stop)
  const hi = Math.max(props.target, props.last ?? props.target)
  const span = hi - lo || 1
  const pos = (v: number) => ((v - lo) / span) * 100
  const risk = props.entry - props.stop
  return {
    stop: pos(props.stop),
    entry: pos(props.entry),
    target: pos(props.target),
    last: props.last ? pos(props.last) : null,
    rr: risk > 0 ? (props.target - props.entry) / risk : null,
    stopPct: props.stop / props.entry - 1,
    targetPct: props.target / props.entry - 1,
    lastPct: props.last ? props.last / props.entry - 1 : null,
  }
})
</script>

<template>
  <div class="w-full">
    <div v-if="!compact" class="mb-1.5 flex items-baseline justify-between text-xs">
      <span class="text-error"><span class="text-muted">стоп</span> <span class="num">{{ fmtNum(stop) }}</span> <span class="num">({{ fmtPct(view.stopPct) }})</span></span>
      <span class="text-highlighted"><span class="text-muted">вход</span> <span class="num">{{ fmtNum(entry) }}</span></span>
      <span class="text-success"><span class="text-muted">цель</span> <span class="num">{{ fmtNum(target) }}</span> <span class="num">(+{{ fmtPct(view.targetPct) }})</span></span>
    </div>
    <div class="relative h-2 rounded-full bg-elevated">
      <div class="absolute inset-y-0 rounded-l-full bg-error/35" :style="{ left: `${view.stop}%`, width: `${view.entry - view.stop}%` }" />
      <div class="absolute inset-y-0 rounded-r-full bg-success/35" :style="{ left: `${view.entry}%`, width: `${view.target - view.entry}%` }" />
      <div class="absolute -inset-y-1 w-0.5 rounded-full bg-inverted" :style="{ left: `calc(${view.entry}% - 1px)` }" />
      <UTooltip v-if="view.last !== null && last !== entry" :text="`Последняя цена ${fmtNum(last)} (${fmtPct(view.lastPct)} от входа)`">
        <div class="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-(--ui-bg)" :style="{ left: `${view.last}%` }" />
      </UTooltip>
    </div>
    <div v-if="!compact" class="mt-1.5 flex justify-between text-[11px] text-muted">
      <span>риск {{ fmtPct(-view.stopPct) }}</span>
      <span class="num">R/R {{ view.rr ? view.rr.toFixed(2) : '—' }}</span>
      <span>потенциал {{ fmtPct(view.targetPct) }}</span>
    </div>
  </div>
</template>

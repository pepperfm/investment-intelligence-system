<script setup lang="ts">
const props = withDefaults(defineProps<{
  verdict: string | null
  direction?: string
  verdictTarget?: string
  size?: 'xs' | 'sm' | 'md'
}>(), { size: 'sm' })

const label = computed(() => {
  if (!props.verdict) {
    return 'Ждёт критика'
  }
  if (props.verdictTarget === 'decision' && props.verdict === 'supported' && props.direction === 'no_trade') {
    return 'Решение не покупать обосновано'
  }
  if (props.verdictTarget === 'legacy') {
    return `${VERDICT_LABELS[props.verdict] ?? props.verdict} · legacy`
  }
  return VERDICT_LABELS[props.verdict] ?? props.verdict
})

const ICONS: Record<string, string> = {
  supported: 'i-lucide-shield-check',
  disputed: 'i-lucide-shield-x',
  insufficient_evidence: 'i-lucide-shield-question',
}
</script>

<template>
  <UBadge
    :color="verdict ? VERDICT_COLORS[verdict] ?? 'neutral' : 'warning'"
    variant="outline"
    :size="size"
    :icon="verdict ? ICONS[verdict] : 'i-lucide-hourglass'"
  >
    {{ label }}
  </UBadge>
</template>

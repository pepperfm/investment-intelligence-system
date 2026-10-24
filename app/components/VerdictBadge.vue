<script setup lang="ts">
withDefaults(defineProps<{
  verdict: string | null
  size?: 'xs' | 'sm' | 'md'
}>(), { size: 'sm' })

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
    {{ verdict ? VERDICT_LABELS[verdict] ?? verdict : 'Ждёт критика' }}
  </UBadge>
</template>

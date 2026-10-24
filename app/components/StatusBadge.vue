<script setup lang="ts">
withDefaults(defineProps<{
  status: string
  size?: 'xs' | 'sm' | 'md'
}>(), { size: 'sm' })
</script>

<template>
  <UBadge
    :color="STATUS_COLORS[status] ?? 'neutral'"
    variant="subtle"
    :size="size"
    class="gap-1.5"
  >
    <span class="size-1.5 rounded-full bg-current" />{{ STATUS_LABELS[status] ?? status }}
  </UBadge>
</template>

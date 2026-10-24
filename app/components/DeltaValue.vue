<script setup lang="ts">
const props = withDefaults(defineProps<{
  value: number | null | undefined
  digits?: number
  arrow?: boolean
  /** Treat values as plain numbers rather than fractions (no ×100, no %). */
  raw?: boolean
}>(), {
  digits: 1,
  arrow: true,
  raw: false,
})
const tone = computed(() => props.value === null || props.value === undefined || Math.abs(props.value) < 1e-9 ? 'flat' : props.value > 0 ? 'up' : 'down')
</script>

<template>
  <span
    class="num inline-flex items-center gap-0.5"
    :class="{ 'text-success': tone === 'up', 'text-error': tone === 'down', 'text-muted': tone === 'flat' }"
  >
    <UIcon
      v-if="arrow && tone !== 'flat'"
      :name="tone === 'up' ? 'i-lucide-arrow-up-right' : 'i-lucide-arrow-down-right'"
      class="size-3.5 shrink-0"
    />
    {{ raw ? fmtNum(value, digits) : fmtPct(value, digits) }}
  </span>
</template>

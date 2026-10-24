<script setup lang="ts">
const props = withDefaults(defineProps<{
  values: number[]
  height?: number
  /** Colour by first→last direction unless forced. */
  color?: string
}>(), { height: 36 })

// UChart's y axis starts at zero; shift the series so its own range fills the height.
const data = computed(() => {
  const min = Math.min(...props.values)
  const max = Math.max(...props.values)
  const floor = min - (max - min) * 0.15
  return props.values.map((v, i) => ({
    i,
    v: v - floor,
  }))
})
const tone = computed(() => props.color ?? ((props.values.at(-1) ?? 0) >= (props.values[0] ?? 0) ? 'success' : 'error'))
</script>

<template>
  <UChart
    v-if="values.length > 1"
    type="area"
    curve="monotone"
    :data="data"
    index="i"
    :categories="['v']"
    :colors="[tone]"
    :height="height"
    :x-axis="false"
    :y-axis="false"
    :grid="false"
    :legend="false"
    :tooltip="false"
    :transition="false"
    aria-label="Динамика цены"
  />
  <div v-else :style="{ height: `${height}px` }" />
</template>

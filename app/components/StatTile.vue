<script setup lang="ts">
import { NuxtLink } from '#components'

defineProps<{
  label: string
  value: string
  hint?: string
  icon?: string
  tone?: 'positive' | 'negative' | 'neutral'
  to?: string
}>()
</script>

<template>
  <component
    :is="to ? NuxtLink : 'div'"
    :to="to"
    class="group relative flex flex-col gap-1 overflow-hidden rounded-xl bg-default p-4 ring ring-default transition-colors"
    :class="to ? 'hover:bg-elevated/50' : ''"
  >
    <div class="flex items-center justify-between gap-2">
      <p class="truncate text-xs font-medium text-muted">
        {{ label }}
      </p>
      <UIcon
        v-if="icon"
        :name="icon"
        class="size-4 shrink-0 text-dimmed transition-colors group-hover:text-primary"
      />
    </div>
    <p
      class="num text-xl font-semibold text-highlighted"
      :class="{ 'text-success!': tone === 'positive', 'text-error!': tone === 'negative' }"
    >
      {{ value }}
    </p>
    <div v-if="hint || $slots.default" class="flex items-center gap-1.5 text-xs text-muted">
      <slot />
      <span v-if="hint" class="truncate">{{ hint }}</span>
    </div>
  </component>
</template>

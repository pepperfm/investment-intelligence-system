<script setup lang="ts">
import type { EvidenceItem, SourceRef } from '#shared/types/investment'

const props = defineProps<{
  items: EvidenceItem[]
  sources: SourceRef[]
  tone: 'support' | 'counter'
}>()

const byId = computed(() => new Map(props.sources.map(s => [s.id, s])))
</script>

<template>
  <ul class="divide-y divide-default">
    <li
      v-for="(item, i) in items"
      :key="i"
      class="flex gap-2.5 py-2.5 first:pt-0 last:pb-0"
    >
      <span class="mt-1.5 size-1.5 shrink-0 rounded-full" :class="tone === 'support' ? 'bg-success' : 'bg-error'" />
      <div class="min-w-0 space-y-1.5">
        <p class="text-sm leading-snug">
          {{ item.claim }}
        </p>
        <div v-if="item.sourceIds.length" class="flex flex-wrap gap-1">
          <SourceChip
            v-for="id in item.sourceIds"
            :id="id"
            :key="id"
            :source="byId.get(id)"
          />
        </div>
      </div>
    </li>
    <li v-if="!items.length" class="text-sm text-muted">
      Нет
    </li>
  </ul>
</template>

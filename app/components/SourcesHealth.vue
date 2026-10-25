<script setup lang="ts">
import type { SourceStatus } from '#shared/types/evidence'

defineProps<{ sources?: ApiResponse<'/api/sources'>['sources'] }>()
const labels: Record<SourceStatus, string> = {
  ok: 'Доступен',
  stale: 'Устарел / частично недоступен',
  unavailable: 'Недоступен',
  not_covered: 'Нет покрытия',
  blocked: 'Доступ ограничен',
}
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="font-medium">
        Состояние источников
      </h2>
    </template>
    <div class="divide-y divide-default">
      <div
        v-for="source in sources"
        :key="source.id"
        class="space-y-1 py-3 first:pt-0"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <a
            :href="source.sourceUrl"
            target="_blank"
            rel="noopener"
            class="text-sm font-medium text-primary hover:underline"
          >{{ source.label }}</a>
          <UBadge :color="source.status === 'ok' ? 'success' : 'warning'" variant="subtle">
            {{ labels[source.status] }}
          </UBadge>
        </div>
        <p class="text-xs text-muted">
          {{ source.tier === 'primary' ? 'Первичный источник' : 'Вторичный источник · числа не сверены' }} · {{ source.accessTerms }}
        </p>
        <p class="text-xs text-muted">
          Последний успех: {{ source.lastSuccessAt ? fmtDate(source.lastSuccessAt, true) : 'ещё нет' }} · Попытка: {{ source.lastAttemptAt ? fmtDate(source.lastAttemptAt, true) : 'ещё нет' }}
        </p>
        <p v-if="source.lastErrorCode" class="text-xs text-warning">
          Ошибка: {{ source.lastErrorCode }}
        </p>
      </div>
    </div>
  </UCard>
</template>

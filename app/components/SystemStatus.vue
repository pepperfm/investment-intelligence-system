<script setup lang="ts">
defineProps<{ collapsed?: boolean }>()

const { data: status } = useSystemStatus()
const healthy = computed(() => Boolean(status.value?.analyst.available && status.value?.critic.available))
</script>

<template>
  <UPopover
    :content="{ side: 'right', align: 'end', sideOffset: 8 }"
    mode="hover"
    :open-delay="0"
  >
    <UButton
      color="neutral"
      variant="ghost"
      :square="collapsed"
      :block="!collapsed"
      class="justify-start"
      aria-label="Статус системы"
    >
      <span class="relative flex size-2.5 shrink-0">
        <span v-if="status?.activeRuns" class="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
        <span class="relative inline-flex size-2.5 rounded-full" :class="healthy ? (status?.activeRuns ? 'bg-primary' : 'bg-success') : 'bg-error'" />
      </span>
      <span v-if="!collapsed" class="flex min-w-0 flex-col items-start leading-tight">
        <span class="text-xs font-medium text-highlighted">manual · проверка критиком</span>
        <span class="truncate text-[11px] text-muted">{{ status?.activeRuns ? `идёт анализ (${status.activeRuns})` : `${status?.analyst.id ?? '…'} · ${status?.codex.model ?? ''}` }}</span>
      </span>
    </UButton>
    <template #content>
      <div v-if="status" class="w-72 space-y-3 p-3 text-sm">
        <p class="section-label">
          Система
        </p>
        <dl class="space-y-1.5">
          <div class="flex justify-between gap-3">
            <dt class="text-muted">
              Режим
            </dt><dd>
              <UBadge size="sm" color="primary">
                manual
              </UBadge>
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted">
              Аналитик
            </dt>
            <dd class="flex items-center gap-1.5">
              <span class="size-1.5 rounded-full" :class="status.analyst.available ? 'bg-success' : 'bg-error'" />{{ status.analyst.id }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted">
              Критик
            </dt>
            <dd class="flex items-center gap-1.5">
              <span class="size-1.5 rounded-full" :class="status.critic.available ? 'bg-success' : 'bg-error'" />{{ status.critic.id }}
            </dd>
          </div>
          <div v-if="status.analyst.id === 'codex' || status.critic.id === 'codex'" class="flex justify-between gap-3">
            <dt class="text-muted">
              Модель Codex
            </dt><dd class="num text-xs">
              {{ status.codex.model }} · {{ status.codex.reasoningEffort }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted">
              Рыночные данные
            </dt><dd>{{ status.marketProvider }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted">
              Эмбеддинги
            </dt><dd>{{ status.embeddingProvider }}</dd>
          </div>
        </dl>
        <USeparator />
        <dl class="grid grid-cols-2 gap-2 text-xs">
          <div>
            <dt class="text-muted">
              Свечей
            </dt><dd class="num text-highlighted">
              {{ fmtNum(status.counts.candles) }}
            </dd>
          </div>
          <div>
            <dt class="text-muted">
              Документов памяти
            </dt><dd class="num text-highlighted">
              {{ fmtNum(status.counts.documents) }}
            </dd>
          </div>
        </dl>
        <UAlert
          color="neutral"
          variant="soft"
          icon="i-lucide-shield"
          title="Реальная торговля выключена"
          :ui="{ title: 'text-xs', icon: 'size-4' }"
        />
      </div>
    </template>
  </UPopover>
</template>

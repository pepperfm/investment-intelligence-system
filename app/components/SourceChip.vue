<script setup lang="ts">
import type { SourceRef } from '#shared/types/investment'

defineProps<{
  id: string
  source?: SourceRef
}>()

const KIND: Record<string, {
  icon: string
  label: string
}> = {
  candles: {
    icon: 'i-lucide-candlestick-chart',
    label: 'Котировки',
  },
  metrics: {
    icon: 'i-lucide-calculator',
    label: 'Расчёт кодом',
  },
  backtest: {
    icon: 'i-lucide-history',
    label: 'Бэктест',
  },
  event: {
    icon: 'i-lucide-newspaper',
    label: 'Событие',
  },
  report: {
    icon: 'i-lucide-file-spreadsheet',
    label: 'Отчётность',
  },
  macro: {
    icon: 'i-lucide-landmark',
    label: 'Макроданные ЦБ',
  },
  regulatory: {
    icon: 'i-lucide-newspaper',
    label: 'Регуляторное событие',
  },
  memory: {
    icon: 'i-lucide-brain',
    label: 'Память',
  },
}
</script>

<template>
  <UPopover
    mode="hover"
    :open-delay="0"
    :content="{ side: 'top' }"
  >
    <button
      type="button"
      class="num inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ring ring-inset transition-colors"
      :class="source ? 'bg-elevated/60 text-toned ring-default hover:bg-elevated' : 'bg-error/10 text-error ring-error/30'"
    >
      <UIcon :name="KIND[source?.kind ?? '']?.icon ?? 'i-lucide-circle-help'" class="size-3" />{{ id }}
    </button>
    <template #content>
      <div class="max-w-xs space-y-1 p-2.5 text-xs">
        <template v-if="source">
          <p class="section-label">
            {{ KIND[source.kind]?.label ?? source.kind }} · {{ fmtDate(source.asOf) }}
          </p>
          <p class="text-sm text-highlighted">
            {{ source.title }}
          </p>
          <p v-if="source.publishedAt">
            Публикация: {{ fmtDate(source.publishedAt, true) }}
          </p>
          <p v-if="source.availableAt">
            Доступно в IIS: {{ fmtDate(source.availableAt, true) }}
          </p>
          <p v-if="source.observedAt">
            Получено: {{ fmtDate(source.observedAt, true) }}
          </p>
          <p v-if="source.verification === 'aggregated_unverified'" class="text-warning">
            Вторичный источник; первичный документ не сверен
          </p>
          <p v-if="source.verification === 'machine_verified'">
            Числа сверены кодом с первичным документом
          </p>
          <p v-if="source.verification === 'manual_verified'">
            Числа подтверждены пользователем по документу
          </p>
          <p
            v-if="source.contentHash"
            class="num truncate"
            :title="source.contentHash"
          >
            SHA-256: {{ source.contentHash }}
          </p>
          <a
            v-if="source.url"
            :href="source.url"
            target="_blank"
            rel="noopener"
            class="text-primary hover:underline"
          >Открыть источник</a>
        </template>
        <p v-else class="text-error">
          Источник не найден в пакете данных — кодовая валидация отметит это как нарушение.
        </p>
      </div>
    </template>
  </UPopover>
</template>

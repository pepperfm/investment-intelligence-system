<script setup lang="ts">
interface Stats {
  count: number
  traded: number
  winRate: number
  avgNetReturn: number
  avgExcessReturn: number | null
  n_abs?: number
  n_relative?: number
  benchmarkStatus?: string
  worstDrawdown: number
  profitFactor: number | null
  benchmarkCount?: number
}
defineProps<{
  rows: {
    label: string
    stats: Stats
    hint?: string
  }[]
}>()
</script>

<template>
  <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead class="text-left text-xs text-muted">
        <tr class="border-b border-default">
          <th class="py-2 pr-3 font-medium">
            Выборка
          </th>
          <th class="px-3 py-2 text-right font-medium">
            Сделок
          </th>
          <th class="px-3 py-2 font-medium">
            Win rate
          </th>
          <th class="px-3 py-2 text-right font-medium">
            Ср. нетто
          </th>
          <th class="px-3 py-2 text-right font-medium">
            Сверх индекса
          </th>
          <th class="px-3 py-2 text-right font-medium">
            Худшая просадка
          </th>
          <th class="py-2 pl-3 text-right font-medium">
            PF
          </th>
        </tr>
      </thead>
      <tbody class="divide-y divide-default">
        <tr
          v-for="r in rows"
          :key="r.label"
          :class="r.stats.traded ? '' : 'opacity-50'"
        >
          <td class="py-2 pr-3">
            <span class="text-highlighted">{{ r.label }}</span>
            <span v-if="r.hint" class="block text-[11px] text-muted">{{ r.hint }}</span>
          </td>
          <td class="num px-3 py-2 text-right">
            {{ r.stats.traded }}<span class="text-dimmed">/{{ r.stats.count }}</span>
          </td>
          <td class="px-3 py-2">
            <div v-if="r.stats.traded" class="flex items-center gap-2">
              <UProgress
                :model-value="r.stats.winRate * 100"
                size="xs"
                :color="r.stats.winRate >= 0.5 ? 'success' : 'warning'"
                class="w-16"
              />
              <span class="num text-xs">{{ fmtPct(r.stats.winRate, 0) }}</span>
            </div>
            <span v-else>—</span>
          </td>
          <td class="px-3 py-2 text-right">
            <DeltaValue :value="r.stats.traded ? r.stats.avgNetReturn : null" :digits="2" />
          </td>
          <td class="px-3 py-2 text-right">
            <DeltaValue
              :value="r.stats.traded && r.stats.benchmarkCount !== 0 ? r.stats.avgExcessReturn : null"
              :digits="2"
              :arrow="false"
            />
            <p v-if="r.stats.n_relative !== undefined" class="mt-1 text-[10px] text-muted">
              {{ r.stats.n_relative }}/{{ r.stats.n_abs ?? r.stats.traded }} сравн.
            </p>
          </td>
          <td class="num px-3 py-2 text-right text-muted">
            {{ r.stats.traded ? fmtPct(r.stats.worstDrawdown) : '—' }}
          </td>
          <td class="num py-2 pl-3 text-right" :class="(r.stats.profitFactor ?? 0) >= 1 ? 'text-success' : 'text-error'">
            <template v-if="r.stats.traded">
              {{ r.stats.profitFactor === null || !Number.isFinite(r.stats.profitFactor) ? '∞' : fmtNum(r.stats.profitFactor, 2) }}
            </template>
            <span v-else>—</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

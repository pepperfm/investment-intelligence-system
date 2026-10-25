<script setup lang="ts">
type Context = ApiResponse<'/api/instruments/:id'>['bankEvidence']
const props = defineProps<{ context: Context }>()
const statusLabel = computed(() => ({
  Active: 'Действует',
  NotActive: 'Не действует по данным реестра',
})[props.context.regulatory?.status ?? 'Active'] ?? 'Статус не установлен')
const form = ref('101')
const search = ref('')
const reports = computed(() => props.context.reports.filter(report => String(report.form) === form.value))
const latest = computed(() => reports.value[0])
const previous = computed(() => reports.value[1])
const rows = computed(() => (latest.value?.rows ?? []).filter(row => Object.values(row).some(value => value.toLowerCase().includes(search.value.toLowerCase()))))
function previousRow(row: Record<string, string>) {
  return previous.value?.rows.find(prior => form.value === '101' ? prior.numsc === row.numsc && prior.ap === row.ap && prior.pln === row.pln : prior.symbol === row.symbol && row.symbol)
}
</script>

<template>
  <div class="space-y-4">
    <UAlert
      color="neutral"
      title="Отдельная кредитная организация"
      description="Формы ЦБ не являются консолидированной МСФО группы. Форма 101 — остатки на дату; форма 102 — накопленные результаты с начала года. Исходные поля сохранены; неподтверждённые коэффициенты не рассчитываются."
    />
    <div v-if="context.regulatory" class="rounded-lg bg-elevated p-3 text-sm">
      <p class="font-medium">
        {{ context.regulatory.name }} · ИНН {{ context.regulatory.inn }}
      </p>
      <p>FinOrg: {{ context.regulatory.status ? statusLabel : 'Статус не установлен' }}</p>
      <p class="text-xs text-muted">
        Получено {{ fmtDate(context.regulatory.provenance.observedAt, true) }}. Архивные лицензии могут иметь дату прекращения.
      </p>
      <details class="mt-2">
        <summary class="cursor-pointer">
          Лицензии и виды деятельности · {{ context.regulatory.licenses.length }}
        </summary>
        <p
          v-for="(license, index) in context.regulatory.licenses"
          :key="index"
          class="mt-2 text-xs"
        >
          {{ license.name || license.activity }} · {{ license.number ?? 'без номера' }} · с {{ license.startDate ?? 'неизвестно' }} · окончание: {{ license.endDate ?? 'в реестре не указано' }}
        </p>
      </details>
    </div>
    <UTabs
      v-model="form"
      :items="[{ label: 'Форма 101', value: '101' }, { label: 'Форма 102', value: '102' }]"
      :content="false"
    />
    <template v-if="latest">
      <p class="text-xs text-muted">
        {{ latest.reportDate }} / {{ previous?.reportDate ?? 'второго периода нет' }} · {{ latest.unit ?? 'единицы не подтверждены' }} · доступно с {{ fmtDate(latest.availableAt, true) }}
      </p>
      <UInput
        v-model="search"
        placeholder="Найти код счёта или название строки"
        class="w-full"
      />
      <div class="max-h-96 overflow-auto">
        <table class="w-full text-left text-xs">
          <thead>
            <tr>
              <th class="p-2">
                Код / исходная строка
              </th><th class="p-2">
                {{ latest.reportDate }}
              </th><th class="p-2">
                {{ previous?.reportDate }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, index) in rows"
              :key="index"
              class="border-t border-default"
            >
              <td class="p-2">
                {{ row.numsc ?? row.symbol ?? '—' }} {{ row.symname ?? '' }} <span v-if="row.ap" class="text-muted">ap={{ row.ap }}, pln={{ row.pln }}</span>
              </td>
              <td class="num whitespace-nowrap p-2">
                {{ row.iitg ?? row.tp3 ?? '—' }}
              </td>
              <td class="num whitespace-nowrap p-2">
                {{ previousRow(row)?.iitg ?? previousRow(row)?.tp3 ?? '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <a
        :href="latest.provenance.sourceUrl"
        target="_blank"
        rel="noopener"
        class="text-xs text-primary hover:underline"
      >Первичный источник ЦБ · форма {{ form }}</a>
    </template>
    <p v-else class="text-sm text-muted">
      Нет опубликованной формы на дату анализа. Отсутствие данных не означает отсутствие рисков.
    </p>
  </div>
</template>

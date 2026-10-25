<script setup lang="ts">
const { data: instruments } = await useFetch<ApiResponse<'/api/instruments'>>('/api/instruments')
const available = computed(() => (instruments.value ?? []).filter(row => row.provider !== 'mock' && row.kind === 'equity').map(row => ({
  label: `${row.ticker} · ${row.name}`,
  value: row.id,
})))
const instrumentId = ref('')
const name = ref('')
const inn = ref('')
const title = ref('')
const sourceUrl = ref('')
const publishedAt = ref('')
const periodStart = ref('')
const periodEnd = ref('')
const reportingStandard = ref('IFRS')
const consolidated = ref(true)
const confirmed = ref(false)
const file = ref<File | null>(null)
const action = useAction()
const facts = ref([{
  metricKey: 'revenue',
  value: '',
  unit: 'млн RUB',
  originalUnit: 'млн руб.',
  locator: '',
}])
const metrics = [
  {
    label: 'Чистый процентный доход банка',
    value: 'net_interest_income',
  },
  {
    label: 'Активы',
    value: 'total_assets',
  },
  {
    label: 'Собственный капитал',
    value: 'equity',
  },
  {
    label: 'Кредитный портфель',
    value: 'loans',
  },
  {
    label: 'Средства клиентов / депозиты',
    value: 'deposits',
  },
  {
    label: 'Достаточность капитала',
    value: 'capital_adequacy',
  },
  {
    label: 'Скорректированная EBITDA (non-IFRS)',
    value: 'adjusted_ebitda',
  },
  {
    label: 'Скорректированная прибыль (non-IFRS)',
    value: 'adjusted_net_profit',
  },

  {
    label: 'Выручка',
    value: 'revenue',
  },
  {
    label: 'EBITDA',
    value: 'ebitda',
  },
  {
    label: 'Операционная прибыль',
    value: 'operating_profit',
  },
  {
    label: 'Чистая прибыль',
    value: 'net_profit',
  },
  {
    label: 'Операционный денежный поток',
    value: 'operating_cash_flow',
  },
  {
    label: 'Долг',
    value: 'debt',
  },
  {
    label: 'Денежные средства',
    value: 'cash',
  },
  {
    label: 'Чистый долг',
    value: 'net_debt',
  },
  {
    label: 'Дивиденд на акцию',
    value: 'dividend_per_share',
  },
]
function selectFile(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null
}
async function submit() {
  if (!file.value) {
    return
  }
  const form = new FormData()
  form.set('file', file.value)
  form.set('metadata', JSON.stringify({
    instrumentId: instrumentId.value,
    issuer: {
      name: name.value,
      inn: inn.value,
    },
    title: title.value,
    sourceUrl: sourceUrl.value,
    reportingStandard: reportingStandard.value,
    consolidated: consolidated.value,
    periodStart: periodStart.value,
    periodEnd: periodEnd.value,
    publishedAt: new Date(`${publishedAt.value}T00:00:00+03:00`).toISOString(),
    confirmed: confirmed.value,
    facts: facts.value,
  }))
  const result = await action.run(() => $fetch<ApiResponse<'/api/issuer-documents', 'post'>>('/api/issuer-documents', {
    method: 'POST',
    body: form,
  }), r => r.duplicate ? 'Этот документ уже загружен; сохранённая версия не изменена' : 'Документ и подтверждённые показатели сохранены')
  if (result) {
    confirmed.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="font-medium">
        Первичный отчёт · ручной импорт
      </h2>
    </template>
    <p class="mb-4 text-sm text-muted">
      Загрузите законно полученный PDF, XLSX или HTML до 20 MB. Сверьте суммы, стандарт и единицы с оригиналом. Данные станут доступны для новых исследований с момента импорта.
    </p>
    <form class="space-y-4" @submit.prevent="submit">
      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField label="Инструмент" required>
          <USelect
            v-model="instrumentId"
            :items="available"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Юридическое лицо" required>
          <UInput
            v-model="name"
            required
            class="w-full"
          />
        </UFormField>
        <UFormField label="ИНН" required>
          <UInput
            v-model="inn"
            required
            class="w-full"
          />
        </UFormField>
        <UFormField label="Название документа" required>
          <UInput
            v-model="title"
            required
            class="w-full"
          />
        </UFormField>
        <UFormField label="Официальная ссылка" required>
          <UInput
            v-model="sourceUrl"
            type="url"
            required
            class="w-full"
          />
        </UFormField>
        <UFormField label="Дата публикации" required>
          <AppDatePicker
            v-model="publishedAt"
            required
          />
        </UFormField>
        <UFormField label="Начало периода" required>
          <AppDatePicker
            v-model="periodStart"
            required
          />
        </UFormField>
        <UFormField label="Конец периода" required>
          <AppDatePicker
            v-model="periodEnd"
            required
          />
        </UFormField>
        <UFormField label="Стандарт">
          <USelect v-model="reportingStandard" :items="['IFRS', 'RAS', 'BANK_REGULATORY']" />
        </UFormField>
        <UCheckbox v-model="consolidated" label="Консолидированная отчётность группы" />
      </div>
      <UFormField label="Оригинал документа" required>
        <input
          type="file"
          accept=".pdf,.xlsx,.html,.htm"
          required
          class="block w-full text-sm text-toned"
          @change="selectFile"
        >
      </UFormField>
      <fieldset
        v-for="(fact, index) in facts"
        :key="index"
        class="grid gap-3 rounded-lg bg-elevated p-3 sm:grid-cols-2"
      >
        <legend class="text-xs text-muted">
          Показатель {{ index + 1 }}
        </legend>
        <UFormField label="Показатель">
          <USelect
            v-model="fact.metricKey"
            :items="metrics"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Значение (точка для дробной части)">
          <UInput
            v-model="fact.value"
            required
            class="w-full"
          />
        </UFormField>
        <UFormField label="Единицы в IIS">
          <UInput
            v-model="fact.unit"
            required
            class="w-full"
          />
        </UFormField>
        <UFormField label="Единицы в оригинале">
          <UInput
            v-model="fact.originalUnit"
            required
            class="w-full"
          />
        </UFormField>
        <UFormField label="Страница / таблица / строка" class="sm:col-span-2">
          <UInput
            v-model="fact.locator"
            required
            class="w-full"
          />
        </UFormField>
        <UButton
          v-if="facts.length > 1"
          color="neutral"
          variant="ghost"
          @click="facts.splice(index, 1)"
        >
          Удалить показатель
        </UButton>
      </fieldset>
      <UButton
        color="neutral"
        variant="outline"
        :disabled="facts.length >= 30"
        @click="facts.push({ metricKey: 'net_profit', value: '', unit: 'млн RUB', originalUnit: 'млн руб.', locator: '' })"
      >
        Добавить показатель
      </UButton>
      <UCheckbox v-model="confirmed" label="Я проверил юридическое лицо, даты, суммы и единицы по оригиналу документа" />
      <UButton
        type="submit"
        :disabled="!confirmed || !file || !instrumentId"
        :loading="action.pending.value"
      >
        Сохранить подтверждённый документ
      </UButton>
      <p v-if="!available.length" class="text-xs text-warning">
        Для импорта нужен реальный инструмент. Документы не смешиваются с mock-историей.
      </p>
    </form>
  </UCard>
</template>

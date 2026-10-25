<script setup lang="ts">
const { data, refresh, error } = await useFetch<ApiResponse<'/api/macro'>>('/api/macro')
const { data: registry, refresh: refreshSources } = await useFetch<ApiResponse<'/api/sources'>>('/api/sources')
const action = useAction()
async function sync() {
  const result = await action.run(() => $fetch<ApiResponse<'/api/sources/sync', 'post'>>('/api/sources/sync', { method: 'POST' }), 'Источники обновлены; проверьте покрытие и ошибки')
  if (result) {
    await Promise.all([refresh(), refreshSources()])
  }
}
async function syncPrimary() {
  const result = await action.run(() => $fetch<ApiResponse<'/api/sources/issuers/sync', 'post'>>('/api/sources/issuers/sync', { method: 'POST' }), r => `Первичные документы: ${r.results.filter(row => row.status === 'ok' || row.status === 'unchanged').length} доступны`)
  if (result) {
    await refreshSources()
    const failures = result.results.filter(row => row.status !== 'ok' && row.status !== 'unchanged')
    primaryErrors.value = failures.map(row => `${row.id}: ${row.error ?? row.status}`).join('; ')
  }
}
const primaryErrors = ref('')
useHead({ title: 'Макро и источники · IIS' })
</script>

<template>
  <UDashboardPanel id="macro">
    <template #header>
      <PageNavbar title="Макро и источники">
        <template #right>
          <UButton
            icon="i-lucide-refresh-cw"
            :loading="action.pending.value"
            @click="sync"
          >
            Обновить ЦБ
          </UButton>
        </template>
      </PageNavbar>
    </template>
    <template #body>
      <div class="mx-auto w-full max-w-5xl space-y-6">
        <UAlert
          color="neutral"
          variant="subtle"
          title="Официальные данные · ручное обновление"
          description="Исторические ряды доступны для исследований с даты первого получения в IIS. Дата действия ставки или курса не заменяет дату доступности. Обновление не запускает AI-анализ."
        />
        <UAlert
          v-if="error"
          color="error"
          title="Не удалось загрузить макроданные"
          :description="apiError(error)"
        />
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <UCard v-for="series in data?.series" :key="series.seriesKey">
            <p class="text-sm text-muted">
              {{ series.label }}
            </p>
            <p class="num mt-2 text-2xl text-highlighted">
              {{ series.value }} <span class="text-sm text-muted">{{ series.unit }}</span>
            </p>
            <p class="mt-2 text-xs text-muted">
              На {{ fmtDate(series.date) }}
            </p>
            <p v-if="series.previous" class="num text-xs text-muted">
              Ранее: {{ series.previous.value }} · {{ fmtDate(series.previous.date) }}
            </p>
            <p class="mt-2 text-xs text-muted">
              Получено: {{ fmtDate(series.provenance.observedAt, true) }}
            </p>
            <a
              :href="series.provenance.sourceUrl"
              target="_blank"
              rel="noopener"
              class="text-xs text-primary hover:underline"
            >Источник ЦБ</a>
            <p v-if="series.momPct !== null" class="num text-xs text-muted">
              MoM: {{ fmtNum(series.momPct, 2) }}%
            </p>
            <p v-if="series.yoyPct !== null" class="num text-xs text-muted">
              YoY: {{ fmtNum(series.yoyPct, 2) }}%
            </p>
            <details v-if="series.history.length" class="mt-3 text-xs">
              <summary class="cursor-pointer text-toned">
                История · {{ series.history.length }} наблюдений
              </summary>
              <div class="mt-2 max-h-48 overflow-auto">
                <p
                  v-for="observation in series.history"
                  :key="observation.id"
                  class="num flex justify-between gap-3 py-1"
                >
                  <span>{{ fmtDate(observation.date) }}</span><span>{{ observation.value }}</span>
                </p>
              </div>
            </details>
          </UCard>
        </div>
        <UEmpty
          v-if="data && !data.series.length"
          icon="i-lucide-landmark"
          title="Макроданные ещё не загружены"
          description="Нажмите «Обновить ЦБ». Finam и его ключ не требуются."
        />
        <SourcesHealth :sources="registry?.sources" />
        <UCard>
          <template #header>
            <h2 class="font-medium">
              Регуляторные события
            </h2>
          </template>
          <div class="space-y-4">
            <article v-for="item in data?.events" :key="item.id">
              <a
                :href="item.provenance.sourceUrl"
                target="_blank"
                rel="noopener"
                class="text-sm font-medium text-primary hover:underline"
              >{{ item.title }}</a>
              <p class="mt-1 line-clamp-3 text-sm text-toned">
                {{ item.body }}
              </p>
              <p class="mt-1 text-xs text-muted">
                Публикация: {{ fmtDate(item.publishedAt) }} · Доступно в IIS: {{ fmtDate(item.availableAt, true) }}
              </p>
            </article>
            <p v-if="!data?.events.length" class="text-sm text-muted">
              События не загружены; это не подтверждает их отсутствие.
            </p>
          </div>
        </UCard>
        <UCard>
          <template #header>
            <h2 class="font-medium">
              Проверенные первичные публикации
            </h2>
          </template>
          <p class="mb-3 text-sm text-muted">
            Разовая загрузка оригиналов Яндекса, Норникеля и формы 102 Сбербанка. Числа сверяются кодом по хэшу PDF, странице, строке и единицам. МСФО группы, показатели non-IFRS и формы отдельного банка различаются. Новая редакция PDF требует проверки экстрактора.
          </p>
          <UButton
            :loading="action.pending.value"
            icon="i-lucide-file-check"
            @click="syncPrimary"
          >
            Загрузить проверенные отчёты
          </UButton>
          <p v-if="primaryErrors" class="mt-3 text-sm text-warning">
            {{ primaryErrors }}
          </p>
        </UCard>
        <IssuerDocumentImport />
        <UCard v-if="registry?.fetches.length">
          <template #header>
            <h2 class="font-medium">
              Последние запросы
            </h2>
          </template>
          <ul class="max-h-64 space-y-2 overflow-auto text-xs text-muted">
            <li
              v-for="item in registry.fetches"
              :key="item.id"
              class="num"
            >
              {{ fmtDate(item.completedAt) }} · {{ item.sourceId }} · HTTP {{ item.httpStatus ?? '—' }} · {{ item.errorCode ?? 'ответ получен' }}
            </li>
          </ul>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>

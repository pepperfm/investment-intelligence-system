<script setup lang="ts">
const { data } = await useFetch('/api/settings')
const { data: status } = useSystemStatus()
const action = useAction()
const form = reactive({
  risk: { ...data.value!.risk },
  costs: { ...data.value!.costs },
})
const initial = JSON.stringify(form)
const dirty = computed(() => JSON.stringify(form) !== initial)

async function save() {
  const { allowLeverage: _l, ...risk } = form.risk
  await action.run(() => $fetch<ApiResponse<'/api/settings', 'put'>>('/api/settings', {
    method: 'PUT',
    body: {
      risk,
      costs: form.costs,
    },
  }), 'Настройки сохранены')
}
const riskFields = [
  ['maxPositionPct', 'Размер позиции', '% капитала на одну бумагу', 0.5],
  ['maxRiskPerTradePct', 'Риск сделки', '% капитала до стопа', 0.1],
  ['maxTotalExposurePct', 'Суммарная экспозиция', '% капитала в бумагах', 1],
  ['maxSectorPct', 'Концентрация в секторе', '% капитала', 1],
  ['maxDailyLossPct', 'Дневной убыток', 'после него новые покупки блокируются', 0.1],
  ['maxAdvParticipationPct', 'Доля дневного оборота', '% от среднего оборота', 0.1],
  ['minAvgTurnover', 'Минимальный оборот', '₽ в день', 1_000_000],
] as const
const costFields = [
  ['commissionPct', 'Комиссия', '% за сторону'],
  ['spreadPct', 'Спред', '% на круг'],
  ['slippagePct', 'Проскальзывание', '% за сторону'],
] as const
const roundTrip = computed(() => 2 * form.costs.commissionPct + form.costs.spreadPct + 2 * form.costs.slippagePct)
useHead({ title: 'Настройки · IIS' })
</script>

<template>
  <UDashboardPanel id="settings">
    <template #header>
      <PageNavbar title="Настройки">
        <template #right>
          <UButton
            :loading="action.pending.value"
            :disabled="!dirty"
            icon="i-lucide-save"
            @click="save"
          >
            Сохранить
          </UButton>
        </template>
      </PageNavbar>
    </template>
    <template #body>
      <div class="mx-auto w-full max-w-4xl space-y-4">
        <UCard>
          <template #header>
            <div>
              <h2 class="font-semibold text-highlighted">
                Лимиты риска
              </h2>
              <p class="text-xs text-muted">
                Проверяются кодом при создании и повторно при подтверждении каждой paper-заявки.
              </p>
            </div>
          </template>
          <div class="divide-y divide-default">
            <div
              v-for="[key, label, hint, step] in riskFields"
              :key="key"
              class="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
            >
              <div>
                <p class="text-sm text-highlighted">
                  {{ label }}
                </p>
                <p class="text-xs text-muted">
                  {{ hint }}
                </p>
              </div>
              <UInputNumber
                v-model="form.risk[key]"
                :step="step"
                :min="0"
                size="sm"
                class="w-40"
              />
            </div>
          </div>
          <template #footer>
            <p class="flex items-center gap-2 text-xs text-muted">
              <UIcon name="i-lucide-lock" class="size-3.5" />Кредитное плечо и короткие продажи запрещены всегда.
            </p>
          </template>
        </UCard>

        <div class="grid gap-4 lg:grid-cols-2">
          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <h2 class="font-semibold text-highlighted">
                  Издержки
                </h2>
                <UBadge color="neutral" class="num">
                  круг ≈ {{ fmtNum(roundTrip, 2) }}%
                </UBadge>
              </div>
            </template>
            <div class="space-y-3">
              <UFormField
                v-for="[key, label, hint] in costFields"
                :key="key"
                :label="label"
                :hint="hint"
              >
                <UInputNumber
                  v-model="form.costs[key]"
                  :step="0.01"
                  :min="0"
                  size="sm"
                  class="w-full"
                />
              </UFormField>
            </div>
          </UCard>

          <UCard>
            <template #header>
              <h2 class="font-semibold text-highlighted">
                Агенты и данные
              </h2>
            </template>
            <dl v-if="status" class="space-y-2.5 text-sm">
              <div
                v-for="[label, health] in [['Аналитик', status.analyst], ['Критик', status.critic]] as const"
                :key="label"
                class="flex items-center justify-between gap-2"
              >
                <dt class="text-muted">
                  {{ label }}
                </dt>
                <dd class="flex items-center gap-2">
                  <span class="size-1.5 rounded-full" :class="health.available ? 'bg-success' : 'bg-error'" />
                  <span>{{ health.id }}</span>
                  <span class="num text-xs text-muted">{{ health.version }}</span>
                </dd>
              </div>
              <div
                v-for="role in status.codex.roles"
                :key="role.role"
                class="flex justify-between gap-2"
              >
                <dt class="text-muted">
                  {{ role.role }} · Codex
                </dt><dd class="num text-xs">
                  {{ role.model }} · {{ role.effort }}
                </dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-muted">
                  Рыночные данные
                </dt><dd>{{ status.marketProvider }}{{ status.finamConfigured ? ' · ключ задан' : '' }}</dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-muted">
                  Эмбеддинги
                </dt><dd>{{ status.embeddingProvider }}</dd>
              </div>
            </dl>
            <template #footer>
              <p class="text-xs text-muted">
                Задаются в <code class="num">.env</code>: <code class="num">NUXT_AI_PROVIDER</code>, <code class="num">NUXT_AI_CRITIC_PROVIDER</code>, <code class="num">NUXT_CODEX_MODEL</code>, <code class="num">NUXT_MARKET_PROVIDER</code>.
                Агенты работают отдельными процессами в пустой временной папке, без секретов в окружении.
              </p>
            </template>
          </UCard>
        </div>

        <UCard>
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 class="font-semibold text-highlighted">
                Тема оформления
              </h2>
              <p class="text-xs text-muted">
                Также в сайдбаре и в поиске ⌘K. Сайдбар сворачивается по ⌘B.
              </p>
            </div>
            <ThemeSwitcher class="w-48" />
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>

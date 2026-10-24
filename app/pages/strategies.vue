<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { NumericRuleKey, StrategyRules } from '#shared/types/investment'

const { data, refresh } = await useFetch('/api/strategies')
const action = useAction()
const toast = useToast()
const selected = ref<'swing' | 'position'>('swing')
const editing = ref<null | {
  strategy: string
  rules: StrategyRules
  notes: string
  base: number
}>(null)

type Stats = {
  count: number
  traded: number
  winRate: number
  avgNetReturn: number
  avgExcessReturn: number
  worstDrawdown: number
  profitFactor: number | null
}
type Comparison = {
  splitAt: string | null
  results: {
    label: string
    inSample: Stats
    outOfSample: Stats
  }[]
}
const backtests = ref<Record<string, Stats>>({})
const comparisons = ref<Record<string, Comparison>>({})

const strategy = computed(() => data.value?.find(s => s.id === selected.value))
const active = computed(() => strategy.value?.versions.find(v => v.status === 'active'))

const RULE_GROUPS: {
  title: string
  keys: NumericRuleKey[]
}[] = [
  {
    title: 'Сетап',
    keys: ['trendSma', 'slowSma', 'breakoutLookback', 'rsiPeriod', 'rsiMin', 'rsiMax', 'momentumLookback', 'minMomentum'],
  },
  {
    title: 'Уровни и горизонт',
    keys: ['stopAtr', 'targetAtr', 'atrPeriod', 'horizonDays', 'entryValidDays', 'minRewardRisk'],
  },
  {
    title: 'Фильтры',
    keys: ['minAvgTurnover', 'maxVolatility', 'regimeSma'],
  },
]
const RULE_LABELS: Record<NumericRuleKey, string> = {
  horizonDays: 'Горизонт, торг. дн.',
  trendSma: 'SMA тренда',
  slowSma: 'Медленная SMA',
  rsiPeriod: 'Период RSI',
  rsiMin: 'RSI min',
  rsiMax: 'RSI max',
  breakoutLookback: 'Окно пробоя',
  momentumLookback: 'Окно моментума',
  minMomentum: 'Мин. моментум',
  atrPeriod: 'Период ATR',
  stopAtr: 'Стоп, ATR',
  targetAtr: 'Цель, ATR',
  minAvgTurnover: 'Мин. оборот, ₽',
  entryValidDays: 'Окно входа, дн.',
  maxVolatility: 'Макс. волатильность',
  minRewardRisk: 'Мин. прибыль/риск',
  regimeSma: 'SMA режима IMOEX (0 = выкл.)',
}
const DEFAULTS: Partial<StrategyRules> = {
  allowPullback: true,
  minRewardRisk: 1.2,
  regimeSma: 0,
}
const value = (rules: StrategyRules, key: keyof StrategyRules) => rules[key] ?? DEFAULTS[key]
function format(v: unknown) {
  return typeof v === 'boolean' ? (v ? 'да' : 'нет') : fmtNum(v as number)
}
function diff(rules: StrategyRules, base?: StrategyRules) {
  if (!base) {
    return []
  }
  const keys = new Set([...Object.keys(rules), ...Object.keys(base)]) as Set<keyof StrategyRules>
  return [...keys].filter(k => value(rules, k) !== value(base, k)).map(k => ({
    key: k,
    label: k === 'allowPullback' ? 'Откат' : RULE_LABELS[k as NumericRuleKey] ?? k,
    from: format(value(base, k)),
    to: format(value(rules, k)),
  }))
}

async function backtest() {
  const result = await action.run(() => $fetch<ApiResponse<'/api/strategies/:strategy/backtest', 'post'>>(`/api/strategies/${selected.value}/backtest`, { method: 'POST' }), 'Бэктест выполнен')
  if (result) {
    backtests.value[selected.value] = result.stats
  }
}
async function propose() {
  const result = await action.run(() => $fetch<ApiResponse<'/api/strategies/:strategy/propose', 'post'>>(`/api/strategies/${selected.value}/propose`, { method: 'POST' }))
  if (!result) {
    return
  }
  if (!result.proposed) {
    toast.add({
      title: 'Предложение не сформировано',
      description: result.reason,
      color: 'warning',
    })
  } else {
    comparisons.value[selected.value] = result.comparison
  }
  await refresh()
}
async function compare(versionIds: string[]) {
  const result = await action.run(() => $fetch<ApiResponse<'/api/strategies/:strategy/compare', 'post'>>(`/api/strategies/${selected.value}/compare`, {
    method: 'POST',
    body: { versionIds },
  }), 'Walk-forward сравнение выполнено')
  if (result) {
    comparisons.value[selected.value] = result
  }
}
async function activate(versionId: string) {
  await action.run(() => $fetch<ApiResponse<'/api/strategy-versions/:id/activate', 'post'>>(`/api/strategy-versions/${versionId}/activate`, { method: 'POST' }), 'Версия активирована. Прошлые гипотезы сохраняют свои версии.')
  await refresh()
}
function startEdit(rules: StrategyRules, base: number) {
  editing.value = {
    strategy: selected.value,
    rules: {
      ...DEFAULTS,
      ...rules,
    } as StrategyRules,
    notes: '',
    base,
  }
}
async function saveProposal() {
  if (!editing.value) {
    return
  }
  const e = editing.value
  await action.run(() => $fetch<ApiResponse<'/api/strategies/:strategy/versions', 'post'>>(`/api/strategies/${e.strategy}/versions`, {
    method: 'POST',
    body: {
      rules: e.rules,
      notes: e.notes,
    },
  }), 'Версия предложена (не активна)')
  editing.value = null
  await refresh()
}
function versionMenu(v: {
  id: string
  version: number
  status: string
  rules: StrategyRules
}): DropdownMenuItem[][] {
  return [[
    {
      label: 'Сравнить с активной',
      icon: 'i-lucide-git-compare',
      disabled: v.status === 'active' || !active.value,
      onSelect: () => compare([active.value!.id, v.id]),
    },
    {
      label: 'Новая версия на основе этой',
      icon: 'i-lucide-copy-plus',
      onSelect: () => startEdit(v.rules, v.version),
    },
  ], [
    {
      label: 'Активировать',
      icon: 'i-lucide-power',
      color: 'warning',
      disabled: v.status === 'active',
      onSelect: () => activate(v.id),
    },
  ]]
}
const comparison = computed(() => comparisons.value[selected.value])
const comparisonChart = computed(() => (comparison.value?.results ?? []).map(r => ({
  version: r.label.split(' ')[0],
  is: +(r.inSample.avgNetReturn * 100).toFixed(2),
  oos: +(r.outOfSample.avgNetReturn * 100).toFixed(2),
})))
const STATUS = {
  active: {
    color: 'success',
    label: 'активна',
  },
  proposed: {
    color: 'warning',
    label: 'предложена',
  },
  retired: {
    color: 'neutral',
    label: 'выведена',
  },
} as const
useHead({ title: 'Стратегии · IIS' })
</script>

<template>
  <UDashboardPanel id="strategies">
    <template #header>
      <PageNavbar title="Стратегии">
        <template #right>
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-history"
            :loading="action.pending.value"
            @click="backtest"
          >
            Бэктест активной
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-sparkles"
            :loading="action.pending.value"
            @click="propose"
          >
            Из ретроспектив
          </UButton>
        </template>
      </PageNavbar>
      <UDashboardToolbar>
        <UTabs
          v-model="selected"
          :items="(data ?? []).map(s => ({ label: s.name, value: s.id, badge: `v${s.versions.find(v => v.status === 'active')?.version ?? '?'}` }))"
          :content="false"
          variant="link"
          size="sm"
          class="-mb-px"
        />
      </UDashboardToolbar>
    </template>
    <template #body>
      <template v-if="strategy">
        <UCard v-if="active">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="max-w-xl">
              <p class="flex items-center gap-2 text-lg font-semibold text-highlighted">
                {{ strategy.name }} v{{ active.version }}
                <UBadge color="success" icon="i-lucide-power">
                  активна
                </UBadge>
              </p>
              <p class="mt-1 text-sm text-muted">
                {{ strategy.description }}
              </p>
              <p class="mt-2 text-sm">
                {{ active.notes }}
              </p>
            </div>
            <div class="grid grid-cols-3 gap-x-6 gap-y-2 text-right text-sm">
              <div>
                <p class="text-[11px] text-muted">
                  Сетап
                </p>
                <p class="font-medium">
                  {{ active.rules.allowPullback === false ? 'пробой' : (strategy.id === 'swing' ? 'откат + пробой' : 'тренд') }}
                </p>
              </div>
              <div>
                <p class="text-[11px] text-muted">
                  Стоп / цель
                </p>
                <p class="num font-medium">
                  {{ active.rules.stopAtr }} / {{ active.rules.targetAtr }} ATR
                </p>
              </div>
              <div>
                <p class="text-[11px] text-muted">
                  Горизонт
                </p>
                <p class="num font-medium">
                  {{ active.rules.horizonDays }} дн.
                </p>
              </div>
              <div>
                <p class="text-[11px] text-muted">
                  Мин. R/R
                </p>
                <p class="num font-medium">
                  {{ active.rules.minRewardRisk ?? 1.2 }}
                </p>
              </div>
              <div>
                <p class="text-[11px] text-muted">
                  Режим рынка
                </p>
                <p class="num font-medium">
                  {{ active.rules.regimeSma ? `SMA${active.rules.regimeSma}` : 'выкл.' }}
                </p>
              </div>
              <div>
                <p class="text-[11px] text-muted">
                  Мин. оборот
                </p>
                <p class="num font-medium">
                  {{ fmtNum(active.rules.minAvgTurnover / 1e6) }} млн
                </p>
              </div>
            </div>
          </div>
          <div v-if="backtests[selected]" class="mt-5 border-t border-default pt-4">
            <p class="section-label mb-2">
              Бэктест активной версии на всей истории
            </p>
            <StatsGrid :rows="[{ label: `v${active.version}`, stats: backtests[selected]! }]" />
          </div>
        </UCard>

        <UCard v-if="comparison" :ui="{ body: 'space-y-4' }">
          <p class="text-xs text-muted">
            IS заканчивается до границы. Повторный подбор по результатам OOS делает этот период
            частью исследования; для независимой проверки нужен новый holdout или forward-период.
          </p>
          <div class="flex items-center justify-between">
            <p class="section-label">
              Walk-forward · граница {{ fmtDate(comparison.splitAt) }}
            </p>
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              square
              aria-label="Скрыть"
              @click="delete comparisons[selected]"
            />
          </div>
          <div class="grid gap-4 lg:grid-cols-[1fr_18rem]">
            <StatsGrid
              :rows="comparison.results.flatMap(r => [
                { label: r.label, hint: 'in-sample (подбор)', stats: r.inSample },
                { label: r.label, hint: 'out-of-sample (проверка)', stats: r.outOfSample },
              ])"
            />
            <UChart
              type="bar"
              :data="comparisonChart"
              index="version"
              :categories="[{ key: 'is', label: 'In-sample' }, { key: 'oos', label: 'Out-of-sample' }]"
              :colors="['var(--ui-text-dimmed)', 'primary']"
              :height="200"
              :format="(v: number) => `${v.toFixed(2)}%`"
            />
          </div>
        </UCard>

        <div class="space-y-2">
          <p class="section-label px-1">
            Версии правил
          </p>
          <div
            v-for="v in strategy.versions"
            :key="v.id"
            class="flex flex-wrap items-start gap-3 rounded-xl bg-default p-4 ring"
            :class="v.status === 'active' ? 'ring-success/40' : 'ring-default'"
          >
            <div class="flex w-20 shrink-0 flex-col gap-1">
              <span class="num text-lg font-semibold text-highlighted">v{{ v.version }}</span>
              <UBadge
                :color="STATUS[v.status as keyof typeof STATUS]?.color ?? 'neutral'"
                size="sm"
                class="w-fit"
              >
                {{ STATUS[v.status as keyof typeof STATUS]?.label ?? v.status }}
              </UBadge>
            </div>
            <div class="min-w-0 flex-1 space-y-2">
              <p class="text-sm">
                {{ v.notes }}
              </p>
              <div class="flex flex-wrap items-center gap-1.5">
                <template v-if="v.status !== 'active' && active">
                  <UBadge
                    v-for="d in diff(v.rules, active.rules)"
                    :key="d.key"
                    color="primary"
                    variant="soft"
                    size="sm"
                    class="num"
                  >
                    {{ d.label }}: {{ d.from }} → {{ d.to }}
                  </UBadge>
                  <span v-if="!diff(v.rules, active.rules).length" class="text-xs text-muted">совпадает с активной</span>
                </template>
                <UPopover mode="hover" :content="{ side: 'top', align: 'start' }">
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="link"
                    icon="i-lucide-list"
                    class="px-1"
                  >
                    все параметры
                  </UButton>
                  <template #content>
                    <div class="grid w-[34rem] max-w-[90vw] grid-cols-3 gap-4 p-3 text-xs">
                      <div v-for="g in RULE_GROUPS" :key="g.title">
                        <p class="section-label mb-1.5">
                          {{ g.title }}
                        </p>
                        <dl class="space-y-1">
                          <div
                            v-for="k in g.keys"
                            :key="k"
                            class="flex justify-between gap-2"
                          >
                            <dt class="text-muted">
                              {{ RULE_LABELS[k] }}
                            </dt>
                            <dd class="num">
                              {{ format(value(v.rules, k)) }}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    </div>
                  </template>
                </UPopover>
              </div>
              <p class="text-[11px] text-muted">
                {{ v.proposedBy === 'outcome_reviewer' ? 'предложено ретроспективами' : v.proposedBy === 'user' ? 'предложено вручную' : 'исходная' }} · {{ fmtDate(v.createdAt) }}<template v-if="v.activatedAt">
                  · активирована {{ fmtDate(v.activatedAt) }}
                </template>
              </p>
            </div>
            <UDropdownMenu :items="versionMenu(v)" :content="{ align: 'end' }">
              <UButton
                icon="i-lucide-ellipsis"
                color="neutral"
                variant="ghost"
                square
                aria-label="Действия с версией"
              />
            </UDropdownMenu>
          </div>
        </div>
      </template>

      <UModal
        :open="Boolean(editing)"
        :title="`Новая версия на основе v${editing?.base}`"
        description="Будет создана в статусе «предложена». Активация — отдельный шаг после сравнения."
        :ui="{ content: 'max-w-3xl' }"
        @update:open="v => !v && (editing = null)"
      >
        <template #body>
          <div v-if="editing" class="space-y-5">
            <USwitch
              v-if="editing.strategy === 'swing'"
              :model-value="editing.rules.allowPullback !== false"
              label="Сетап «откат» (pullback)"
              description="Пробой учитывается всегда"
              @update:model-value="v => editing && (editing.rules.allowPullback = v)"
            />
            <div v-for="g in RULE_GROUPS" :key="g.title">
              <p class="section-label mb-2">
                {{ g.title }}
              </p>
              <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <UFormField
                  v-for="k in g.keys"
                  :key="k"
                  :label="RULE_LABELS[k]"
                  :ui="{ label: 'text-xs' }"
                >
                  <UInputNumber
                    v-model="editing.rules[k]"
                    :step="k === 'minAvgTurnover' ? 1_000_000 : 0.1"
                    size="sm"
                    class="w-full"
                  />
                </UFormField>
              </div>
            </div>
            <UFormField label="Обоснование">
              <UTextarea
                v-model="editing.notes"
                autoresize
                placeholder="Что меняем и почему; на каком периоде подбирали"
                class="w-full"
              />
            </UFormField>
          </div>
        </template>
        <template #footer>
          <div class="flex w-full justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              @click="editing = null"
            >
              Отмена
            </UButton>
            <UButton
              :loading="action.pending.value"
              icon="i-lucide-git-pull-request-arrow"
              @click="saveProposal"
            >
              Предложить версию
            </UButton>
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>

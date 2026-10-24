<script setup lang="ts">
type Result = ApiResponse<'/api/memory/search'>[number]
const q = ref('')
const before = ref('')
const kinds = ref<string[]>([])
const results = ref<Result[] | null>(null)
const action = useAction()

const KINDS = [
  {
    value: 'retrospective',
    label: 'Ретроспективы',
    icon: 'i-lucide-notebook-pen',
  },
  {
    value: 'hypothesis',
    label: 'Гипотезы',
    icon: 'i-lucide-lightbulb',
  },
  {
    value: 'event',
    label: 'События',
    icon: 'i-lucide-newspaper',
  },
] as const
const KIND_INFO = Object.fromEntries(KINDS.map(k => [k.value, k]))
const shown = computed(() => (results.value ?? []).filter(r => !kinds.value.length || kinds.value.includes(r.kind)))
const SUGGESTIONS = ['пробой максимума после дивидендов', 'регулятор начал проверку', 'стоп сработал на небольшой просадке', 'высокая ставка ЦБ давит на оценку']

async function submit(text?: string) {
  if (text) {
    q.value = text
  }
  if (q.value.trim().length < 2) {
    return
  }
  const r = await action.run(() => $fetch<Result[]>('/api/memory/search', {
    query: {
      q: q.value,
      before: before.value || undefined,
      limit: 30,
    },
  }))
  if (r) {
    results.value = r
  }
}
async function reindex() {
  await action.run(() => $fetch<ApiResponse<'/api/memory/reindex', 'post'>>('/api/memory/reindex', { method: 'POST' }), r => `Переиндексировано ${r.reindexed}`)
}
function toggleKind(k: string) {
  kinds.value = kinds.value.includes(k) ? kinds.value.filter(x => x !== k) : [...kinds.value, k]
}
function hypothesisLink(r: Result) {
  return r.kind === 'hypothesis' || r.kind === 'retrospective' ? `/hypotheses/${r.refId.split(':').at(-1)}` : null
}
useHead({ title: 'Память · IIS' })
</script>

<template>
  <UDashboardPanel id="memory">
    <template #header>
      <PageNavbar title="Память">
        <template #right>
          <UTooltip text="Пересчитать эмбеддинги всех документов (после смены модели)">
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-database-zap"
              :loading="action.pending.value"
              @click="reindex"
            >
              Переиндексировать
            </UButton>
          </UTooltip>
        </template>
      </PageNavbar>
    </template>
    <template #body>
      <div class="mx-auto w-full max-w-3xl space-y-4">
        <form class="space-y-3" @submit.prevent="submit()">
          <UInput
            v-model="q"
            icon="i-lucide-search"
            size="xl"
            placeholder="Опишите ситуацию: «пробой после отчёта при высокой ставке»"
            class="w-full"
            :loading="action.pending.value"
            :ui="{ trailing: 'pe-1.5' }"
          >
            <template #trailing>
              <UButton
                type="submit"
                size="sm"
                :disabled="q.trim().length < 2"
              >
                Найти
              </UButton>
            </template>
          </UInput>
          <div class="flex flex-wrap items-center gap-2">
            <UButton
              v-for="k in KINDS"
              :key="k.value"
              size="xs"
              :icon="k.icon"
              :color="kinds.includes(k.value) ? 'primary' : 'neutral'"
              :variant="kinds.includes(k.value) ? 'subtle' : 'outline'"
              @click="toggleKind(k.value)"
            >
              {{ k.label }}
            </UButton>
            <span class="mx-1 h-4 w-px bg-(--ui-border)" />
            <UTooltip text="Point-in-time: только то, что было доступно к этой дате">
              <UInput
                v-model="before"
                type="date"
                size="xs"
                icon="i-lucide-calendar-clock"
                class="w-40"
              />
            </UTooltip>
          </div>
        </form>

        <div v-if="results === null" class="space-y-2 pt-4">
          <p class="section-label">
            Попробуйте
          </p>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-for="s in SUGGESTIONS"
              :key="s"
              size="sm"
              color="neutral"
              variant="soft"
              @click="submit(s)"
            >
              {{ s }}
            </UButton>
          </div>
          <p class="pt-4 text-xs text-muted">
            Векторный поиск по pgvector (косинусная близость). Числа хранятся типизированно в SQL, здесь — тексты событий, гипотез и ретроспектив.
          </p>
        </div>

        <ul v-else class="space-y-2">
          <li
            v-for="r in shown"
            :key="r.id"
            class="rounded-xl bg-default p-4 ring ring-default"
          >
            <div class="flex items-start gap-3">
              <UIcon :name="KIND_INFO[r.kind]?.icon ?? 'i-lucide-file'" class="mt-0.5 size-4 shrink-0 text-muted" />
              <div class="min-w-0 flex-1 space-y-1">
                <div class="flex flex-wrap items-center gap-2">
                  <component
                    :is="hypothesisLink(r) ? resolveComponent('NuxtLink') : 'span'"
                    :to="hypothesisLink(r) ?? undefined"
                    class="font-medium text-highlighted"
                    :class="hypothesisLink(r) ? 'hover:underline' : ''"
                  >
                    {{ r.title }}
                  </component>
                </div>
                <p class="line-clamp-3 text-sm whitespace-pre-line text-toned">
                  {{ r.content }}
                </p>
                <p class="text-xs text-muted">
                  {{ KIND_INFO[r.kind]?.label ?? r.kind }} · доступно с {{ fmtDate(r.availableAt) }}
                </p>
              </div>
              <UTooltip :text="`Косинусная близость ${fmtNum(r.similarity, 3)}`">
                <div class="flex w-16 shrink-0 flex-col items-end gap-1">
                  <span class="num text-xs text-highlighted">{{ fmtNum(r.similarity, 2) }}</span>
                  <UProgress
                    :model-value="Math.max(0, r.similarity) * 100"
                    size="2xs"
                    class="w-full"
                  />
                </div>
              </UTooltip>
            </div>
          </li>
          <UEmpty
            v-if="!shown.length"
            icon="i-lucide-search-x"
            title="Ничего похожего"
            size="sm"
            variant="naked"
          />
        </ul>
      </div>
    </template>
  </UDashboardPanel>
</template>

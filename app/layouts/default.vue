<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const route = useRoute()
const searchOpen = ref(false)
const sidebarCollapsed = ref(false)
defineShortcuts({
  meta_b: () => {
    sidebarCollapsed.value = !sidebarCollapsed.value
  },
})
const { data: status, refresh } = useSystemStatus()
watch(() => route.fullPath, () => refresh())
const { pause, resume } = useIntervalFn(() => refresh(), 4000, { immediate: false })
watch(() => status.value?.activeRuns, n => n ? resume() : pause(), { immediate: true })

const toDecide = computed(() => (status.value?.byStatus.ready_for_user ?? 0) + (status.value?.byStatus.needs_review ?? 0))

function badge(value: number | undefined, color: 'primary' | 'warning' | 'neutral' = 'neutral') {
  return value
    ? {
        label: String(value),
        color,
        variant: 'subtle' as const,
        size: 'sm' as const,
        class: 'num',
      }
    : undefined
}

const groups = computed<NavigationMenuItem[][]>(() => {
  const byPath = Object.fromEntries(NAV_ITEMS.map(i => [i.to, i]))
  const item = (to: string, extra: Partial<NavigationMenuItem> = {}): NavigationMenuItem => ({
    ...byPath[to]!,
    ...extra,
  })
  return [
    [
      item('/'),
      item('/research', { badge: badge(status.value?.activeRuns, 'primary') }),
      item('/hypotheses', { badge: badge(toDecide.value, 'warning') }),
      item('/instruments'),
    ],
    [
      item('/portfolio', { badge: badge(status.value?.pendingOrders, 'warning') }),
      item('/evaluations'),
      item('/strategies'),
      item('/memory'),
    ],
  ]
})
</script>

<template>
  <UDashboardGroup unit="rem">
    <UDashboardSidebar
      id="main"
      v-model:collapsed="sidebarCollapsed"
      collapsible
      resizable
      :default-size="15"
      :min-size="12"
      :max-size="20"
      :collapsed-size="4"
      :ui="{ footer: 'flex-col items-stretch gap-1 border-t border-default', body: 'gap-5' }"
    >
      <template #header="{ collapsed }">
        <NuxtLink
          to="/"
          class="flex min-w-0 items-center gap-2.5"
          :class="collapsed ? 'mx-auto' : 'px-1'"
          aria-label="IIS — обзор"
        >
          <BrandMark class="size-8" />
          <span v-if="!collapsed" class="flex min-w-0 flex-col leading-none">
            <span class="text-sm font-semibold tracking-[0.16em] text-highlighted">IIS</span>
            <span class="mt-1 text-[11px] text-muted">личный research desk</span>
          </span>
        </NuxtLink>
      </template>
      <template #default="{ collapsed }">
        <UDashboardSearchButton
          :collapsed="collapsed"
          label="Поиск…"
          class="bg-transparent ring-default"
          @click="searchOpen = true"
        />
        <div class="space-y-4">
          <div v-for="(group, i) in groups" :key="i">
            <p v-if="!collapsed" class="section-label mb-1 px-2.5">
              {{ i === 0 ? 'Анализ' : 'Результаты' }}
            </p>
            <UNavigationMenu
              :collapsed="collapsed"
              :items="group"
              orientation="vertical"
              tooltip
              popover
            />
          </div>
        </div>
      </template>
      <template #footer="{ collapsed }">
        <SystemStatus :collapsed="collapsed" />
        <ThemeSwitcher :collapsed="collapsed" class="my-1" />
        <UserMenu :collapsed="collapsed" />
      </template>
    </UDashboardSidebar>
    <slot />
    <AppSearch v-model:open="searchOpen" />
  </UDashboardGroup>
</template>

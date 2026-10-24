<script setup lang="ts">
defineProps<{
  title: string
  back?: string
  badge?: string | number
}>()
</script>

<template>
  <UDashboardNavbar :ui="{ title: 'text-base' }">
    <template #leading>
      <UDashboardSidebarCollapse class="hidden lg:inline-flex" />
      <UButton
        v-if="back"
        :to="back"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        square
        aria-label="Назад"
      />
    </template>
    <template #title>
      <span class="truncate">{{ title }}</span>
      <UBadge
        v-if="badge !== undefined"
        color="neutral"
        size="sm"
        class="num"
      >
        {{ badge }}
      </UBadge>
      <slot name="title-extra" />
    </template>
    <template #right>
      <slot name="right" />
    </template>
  </UDashboardNavbar>
</template>

<script setup lang="ts">
defineProps<{ collapsed?: boolean }>()

const colorMode = useColorMode()
const modes = [
  {
    value: 'light',
    label: 'Светлая',
    icon: 'i-lucide-sun',
  },
  {
    value: 'dark',
    label: 'Тёмная',
    icon: 'i-lucide-moon',
  },
  {
    value: 'system',
    label: 'Как в системе',
    icon: 'i-lucide-monitor',
  },
] as const
const current = computed(() => modes.find(m => m.value === colorMode.preference) ?? modes[2])
const menu = computed(() => [modes.map(m => ({
  label: m.label,
  icon: m.icon,
  type: 'checkbox' as const,
  checked: colorMode.preference === m.value,
  onSelect: () => {
    colorMode.preference = m.value
  },
}))])
</script>

<template>
  <ClientOnly>
    <UDropdownMenu
      v-if="collapsed"
      :items="menu"
      :content="{ side: 'right', align: 'end' }"
    >
      <UButton
        :icon="current.icon"
        color="neutral"
        variant="ghost"
        square
        aria-label="Тема"
      />
    </UDropdownMenu>
    <div
      v-else
      class="grid grid-cols-3 gap-0.5 rounded-md bg-elevated p-0.5"
      role="radiogroup"
      aria-label="Тема"
    >
      <UTooltip
        v-for="m in modes"
        :key="m.value"
        :text="m.label"
      >
        <button
          type="button"
          role="radio"
          :aria-checked="colorMode.preference === m.value"
          :aria-label="m.label"
          class="flex h-7 items-center justify-center rounded-[calc(var(--ui-radius)-2px)] text-muted transition-colors hover:text-default aria-checked:bg-default aria-checked:text-highlighted aria-checked:shadow-xs"
          @click="colorMode.preference = m.value"
        >
          <UIcon :name="m.icon" class="size-4" />
        </button>
      </UTooltip>
    </div>
    <template #fallback>
      <div class="h-8" />
    </template>
  </ClientOnly>
</template>

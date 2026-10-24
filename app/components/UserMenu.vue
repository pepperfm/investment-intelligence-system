<script setup lang="ts">
import { authClient } from '~/lib/auth-client'

defineProps<{ collapsed?: boolean }>()

const { data: me } = useFetch('/api/me', { key: 'me' })
const initials = computed(() => (me.value?.user.name ?? '?').split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase())

async function signOut() {
  await authClient.signOut()
  clearNuxtData()
  await navigateTo('/login')
}
const items = computed(() => [[{
  type: 'label' as const,
  label: me.value?.user.email ?? '',
}], [{
  label: 'Аккаунт и сессии',
  icon: 'i-lucide-user',
  to: '/account',
}, {
  label: 'Настройки',
  icon: 'i-lucide-settings',
  to: '/settings',
}], [{
  label: 'Выйти',
  icon: 'i-lucide-log-out',
  color: 'error' as const,
  onSelect: signOut,
}]])
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'center', collisionPadding: 12 }"
    :ui="{ content: collapsed ? 'w-48' : 'w-(--reka-dropdown-menu-trigger-width)' }"
  >
    <UButton
      :label="collapsed ? undefined : me?.user.name"
      :trailing-icon="collapsed ? undefined : 'i-lucide-chevrons-up-down'"
      color="neutral"
      variant="ghost"
      block
      :square="collapsed"
      class="data-[state=open]:bg-elevated"
      :ui="{ trailingIcon: 'text-dimmed' }"
    >
      <template #leading>
        <UAvatar :text="initials" size="2xs" />
      </template>
    </UButton>
  </UDropdownMenu>
</template>

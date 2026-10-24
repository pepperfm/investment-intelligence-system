<script setup lang="ts">
import { authClient } from '~/lib/auth-client'

const { data: me } = await useFetch('/api/me')
const sessions = ref<Awaited<ReturnType<typeof authClient.listSessions>>['data']>([])
const error = ref('')
const pending = ref(false)

async function loadSessions() {
  const result = await authClient.listSessions()
  if (result.error) {
    throw new Error(result.error.message ?? 'Could not load sessions')
  }
  sessions.value = result.data
}
onMounted(async () => {
  try {
    await loadSessions()
  } catch {
    error.value = 'Could not load sessions'
  }
})
async function revoke(token: string) {
  if (pending.value) {
    return
  }
  pending.value = true
  error.value = ''
  try {
    const result = await authClient.revokeSession({ token })
    if (result.error) {
      throw new Error(result.error.message)
    }
    await loadSessions()
  } catch {
    error.value = 'Could not revoke the session'
  } finally {
    pending.value = false
  }
}
async function signOut() {
  if (pending.value) {
    return
  }
  pending.value = true
  error.value = ''
  try {
    const result = await authClient.signOut()
    if (result.error) {
      throw new Error(result.error.message)
    }
    clearNuxtData()
    await navigateTo('/login')
  } catch {
    error.value = 'Could not sign out'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="account">
    <template #header>
      <PageNavbar title="Аккаунт">
        <template #right>
          <UButton
            variant="outline"
            icon="i-lucide-log-out"
            :disabled="pending"
            @click="signOut"
          >
            Выйти
          </UButton>
        </template>
      </PageNavbar>
    </template>
    <template #body>
      <UCard>
        <p class="font-semibold">
          {{ me?.user.name }}
        </p>
        <p class="text-sm text-muted">
          {{ me?.user.email }}
        </p>
      </UCard>
      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        :title="error"
      />
      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Активные сессии
          </h2>
        </template>
        <ul class="divide-y divide-default text-sm">
          <li
            v-for="session in sessions ?? []"
            :key="session.id"
            class="py-2 flex items-center gap-3"
          >
            <div class="flex-1">
              <p>{{ session.userAgent || 'Неизвестное устройство' }}</p>
              <p class="text-muted">
                {{ session.ipAddress || '—' }} · {{ new Date(session.createdAt).toLocaleString('ru-RU') }}
              </p>
            </div>
            <UBadge v-if="session.id === me?.session.id">
              Текущая
            </UBadge>
            <UButton
              v-else
              size="xs"
              variant="outline"
              :disabled="pending"
              @click="revoke(session.token)"
            >
              Отозвать
            </UButton>
          </li>
        </ul>
      </UCard>
    </template>
  </UDashboardPanel>
</template>

<script setup lang="ts">
import { authClient } from '~/lib/auth-client'

definePageMeta({ layout: false })

const email = ref('')
const password = ref('')
const name = ref('')
const register = ref(false)
const pending = ref(false)
const showPassword = ref(false)
const error = ref('')

async function submit() {
  if (pending.value) {
    return
  }
  pending.value = true
  error.value = ''
  try {
    const result = register.value
      ? await authClient.signUp.email({
          email: email.value,
          password: password.value,
          name: name.value,
        })
      : await authClient.signIn.email({
          email: email.value,
          password: password.value,
        })
    if (result.error) {
      error.value = result.error.message ?? 'Authentication failed'
      return
    }
    await navigateTo('/')
  } catch {
    error.value = 'Could not reach the server. Please try again.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <main class="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
    <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--ui-color-primary-500)_0%,transparent_55%)] opacity-[0.08]" />
    <div class="relative w-full max-w-sm space-y-6">
      <div class="flex flex-col items-center gap-3 text-center">
        <span class="flex size-11 items-center justify-center rounded-xl bg-primary text-inverted shadow-lg shadow-primary/20">
          <UIcon name="i-lucide-activity" class="size-6" />
        </span>
        <div>
          <h1 class="text-xl font-semibold tracking-tight text-highlighted">
            {{ register ? 'Локальный аккаунт' : 'IIS · research desk' }}
          </h1>
          <p class="text-sm text-muted">
            Исследование акций с независимой проверкой гипотез. Не автотрейдер.
          </p>
        </div>
      </div>
      <UCard>
        <form class="space-y-4" @submit.prevent="submit">
          <UFormField v-if="register" label="Имя">
            <UInput
              v-model="name"
              autocomplete="name"
              required
              maxlength="100"
              icon="i-lucide-user"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Email">
            <UInput
              v-model="email"
              type="email"
              autocomplete="email"
              required
              maxlength="254"
              icon="i-lucide-at-sign"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Пароль" :hint="register ? 'от 8 символов' : undefined">
            <UInput
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              :autocomplete="register ? 'new-password' : 'current-password'"
              required
              minlength="8"
              maxlength="128"
              icon="i-lucide-key-round"
              class="w-full"
              :ui="{ trailing: 'pe-1' }"
            >
              <template #trailing>
                <UButton
                  color="neutral"
                  variant="link"
                  size="sm"
                  :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                  :aria-label="showPassword ? 'Скрыть пароль' : 'Показать пароль'"
                  @click="showPassword = !showPassword"
                />
              </template>
            </UInput>
          </UFormField>
          <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="error"
          />
          <UButton
            type="submit"
            block
            size="lg"
            :loading="pending"
          >
            {{ register ? 'Создать и войти' : 'Войти' }}
          </UButton>
        </form>
      </UCard>
      <p class="text-center text-sm text-muted">
        {{ register ? 'Уже есть аккаунт?' : 'Первый запуск?' }}
        <UButton
          variant="link"
          :disabled="pending"
          class="px-1"
          @click="register = !register"
        >
          {{ register ? 'Войти' : 'Создать локальный аккаунт' }}
        </UButton>
      </p>
      <div class="flex justify-center">
        <ThemeSwitcher class="w-32" />
      </div>
    </div>
  </main>
</template>

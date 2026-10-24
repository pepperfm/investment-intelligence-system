<script setup lang="ts">
// Global UX: hints appear instantly; toasts are brief, top-right, without a progress bar.
const tooltip = {
  delayDuration: 0,
  skipDelayDuration: 0,
}
const toaster = {
  position: 'top-right' as const,
  duration: 2000,
  progress: false,
}
</script>

<template>
  <UApp :tooltip="tooltip" :toaster="toaster">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>

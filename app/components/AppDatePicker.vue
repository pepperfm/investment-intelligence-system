<script setup lang="ts">
import { CalendarDate, parseDate } from '@internationalized/date'
import type { DateValue } from '@internationalized/date'

const props = defineProps<{
  min?: string
  max?: string
  disabled?: boolean
}>()
const model = defineModel<string>({ default: '' })
const open = shallowRef(false)
const inputDate = useTemplateRef('inputDate')
const value = computed({
  get: () => model.value ? parseDate(model.value) : undefined,
  set: (date: DateValue | null | undefined) => {
    model.value = date?.toString() ?? ''
  },
})
const minValue = computed(() => props.min ? parseDate(props.min) : undefined)
const maxValue = computed(() => props.max ? parseDate(props.max) : undefined)

function selectDate(date: unknown) {
  if (!(date instanceof CalendarDate)) {
    return
  }
  value.value = date
  open.value = false
}
</script>

<template>
  <UInputDate
    ref="inputDate"
    v-model="value"
    locale="ru-RU"
    :min-value="minValue"
    :max-value="maxValue"
    :disabled="disabled"
    :ui="{ base: 'pe-14' }"
  >
    <template #trailing>
      <UButton
        v-if="model"
        type="button"
        color="neutral"
        variant="link"
        size="xs"
        icon="i-lucide-x"
        aria-label="Очистить дату"
        :disabled="disabled"
        class="px-0"
        @click="model = ''"
      />
      <UPopover v-model:open="open" :reference="inputDate?.inputsRef[0]?.$el">
        <UButton
          type="button"
          color="neutral"
          variant="link"
          size="sm"
          icon="i-lucide-calendar"
          aria-label="Выбрать дату"
          :disabled="disabled"
          class="px-0"
        />
        <template #content>
          <UCalendar
            :model-value="value"
            locale="ru-RU"
            :week-starts-on="1"
            :min-value="minValue"
            :max-value="maxValue"
            class="p-2"
            @update:model-value="selectDate"
          />
        </template>
      </UPopover>
    </template>
  </UInputDate>
</template>

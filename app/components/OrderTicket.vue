<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{
  instrument: {
    id: string
    ticker: string
    name: string
    lotSize: number
  }
  hypothesisId?: string
  entry?: number
  stopLoss?: number
  defaultSide?: 'buy' | 'sell'
  defaultQuantity?: number
}>()
const emit = defineEmits<{ created: [] }>()

const side = ref<'buy' | 'sell'>(props.defaultSide ?? 'buy')
const type = ref<'market' | 'limit'>('market')
const quantity = ref(props.defaultQuantity ?? props.instrument.lotSize)
const limitPrice = ref<number | undefined>(props.entry)
const idempotencyKey = ref(crypto.randomUUID())
const create = useAction()
const confirm = useAction()
type Order = ApiResponse<'/api/orders', 'post'>
const created = ref<Order | null>(null)

type Preview = Awaited<ReturnType<typeof fetchPreview>>
const preview = ref<Preview | null>(null)
const previewError = ref('')

function body() {
  return {
    hypothesisId: props.hypothesisId,
    instrumentId: props.instrument.id,
    side: side.value,
    type: type.value,
    quantity: quantity.value,
    limitPrice: type.value === 'limit' ? limitPrice.value : undefined,
    idempotencyKey: idempotencyKey.value,
  }
}

function fetchPreview() {
  return $fetch<ApiResponse<'/api/orders/preview', 'post'>>('/api/orders/preview', {
    method: 'POST',
    body: body(),
  })
}

const refreshPreview = useDebounceFn(async () => {
  if (!open.value || quantity.value < 1) {
    return
  }
  try {
    preview.value = await fetchPreview()
    previewError.value = ''
  } catch (error) {
    preview.value = null
    previewError.value = apiError(error)
  }
}, 250)

watch([open, side, type, quantity, limitPrice], () => {
  created.value = null
  refreshPreview()
}, { immediate: true })

watch(open, (value) => {
  if (value) {
    idempotencyKey.value = crypto.randomUUID()
    created.value = null
  }
})

async function submit() {
  const order = await create.run(() => $fetch<Order>('/api/orders', {
    method: 'POST',
    body: body(),
  }))
  if (order) {
    created.value = order
  }
}

async function confirmOrder() {
  if (!created.value) {
    return
  }
  const order = await confirm.run(() => $fetch<Order>(`/api/orders/${created.value!.id}/confirm`, { method: 'POST' }), o => `Заявка: ${o.status}`)
  if (order) {
    created.value = order
    emit('created')
    if (order.status === 'filled' || order.status === 'working') {
      open.value = false
    }
  }
}
const sideItems = [
  {
    label: 'Купить',
    value: 'buy',
  },
  {
    label: 'Продать',
    value: 'sell',
  },
]
const typeItems = [
  {
    label: 'Рыночная',
    value: 'market',
  },
  {
    label: 'Лимитная',
    value: 'limit',
  },
]
</script>

<template>
  <UModal
    v-model:open="open"
    :title="`Paper-заявка · ${instrument.ticker}`"
    description="Симуляция. Реальные заявки брокеру не отправляются."
  >
    <template #body>
      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-3">
          <UFormField label="Направление">
            <USelect
              v-model="side"
              :items="sideItems"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Тип">
            <USelect
              v-model="type"
              :items="typeItems"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="`Количество (лот ${instrument.lotSize})`">
            <UInputNumber
              v-model="quantity"
              :min="instrument.lotSize"
              :step="instrument.lotSize"
              class="w-full"
            />
          </UFormField>
          <UFormField v-if="type === 'limit'" label="Лимитная цена">
            <UInputNumber
              v-model="limitPrice"
              :min="0"
              :step="0.01"
              class="w-full"
            />
          </UFormField>
        </div>
        <UAlert
          v-if="previewError"
          color="error"
          variant="subtle"
          :title="previewError"
        />
        <div v-if="preview" class="text-sm space-y-1">
          <p>Цена оценки: <b class="num">{{ fmtNum(preview.price) }}</b> <span class="text-muted">(последнее закрытие {{ fmtNum(preview.lastClose) }} на {{ fmtDate(preview.lastCloseAt) }})</span></p>
          <p>Сумма: <b class="num">{{ fmtMoney(preview.riskCheck.notional) }}</b>, комиссия ≈ {{ fmtMoney(preview.estimatedCommission) }}</p>
          <p v-if="preview.stopLoss !== null">
            Стоп {{ fmtNum(preview.stopLoss) }} · риск {{ fmtMoney(preview.riskCheck.riskAmount) }}
          </p>
          <p>Экспозиция после: {{ fmtNum(preview.riskCheck.exposureAfterPct, 1) }}% · сектор: {{ fmtNum(preview.riskCheck.sectorAfterPct, 1) }}%</p>
          <p v-if="preview.suggestedQuantity !== null">
            Рекомендуемый размер по лимитам риска:
            <UButton
              size="xs"
              variant="link"
              @click="quantity = preview.suggestedQuantity || instrument.lotSize"
            >
              {{ preview.suggestedQuantity }}
            </UButton>
          </p>
          <UAlert
            v-for="v in preview.riskCheck.violations"
            :key="v"
            color="error"
            variant="soft"
            :title="v"
          />
          <UAlert
            v-for="w in preview.riskCheck.warnings"
            :key="w"
            color="warning"
            variant="soft"
            :title="w"
          />
        </div>
        <UAlert
          v-if="created"
          :color="created.status === 'rejected' ? 'error' : 'info'"
          variant="subtle"
          :title="created.status === 'pending_confirmation' ? 'Заявка создана и ждёт подтверждения' : `Статус: ${created.status}`"
          :description="created.rejectReason ?? undefined"
        />
      </div>
    </template>
    <template #footer>
      <div class="flex gap-2 w-full justify-end">
        <UButton
          v-if="!created || created.status === 'rejected'"
          :disabled="!preview?.riskCheck.ok"
          :loading="create.pending.value"
          @click="submit"
        >
          Создать заявку
        </UButton>
        <UButton
          v-else-if="created.status === 'pending_confirmation'"
          color="warning"
          icon="i-lucide-shield-check"
          :loading="confirm.pending.value"
          @click="confirmOrder"
        >
          Подтвердить {{ side === 'buy' ? 'покупку' : 'продажу' }} {{ quantity }} шт.
        </UButton>
      </div>
    </template>
  </UModal>
</template>

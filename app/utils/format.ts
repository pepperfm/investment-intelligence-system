const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })

export function fmtNum(value: number | null | undefined, digits?: number) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  if (digits !== undefined) {
    return new Intl.NumberFormat('ru-RU', {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(value)
  }
  return Math.abs(value) >= 1000 ? nf0.format(value) : nf.format(value)
}

export function fmtMoney(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${nf0.format(value)} ₽`
}

export function fmtPct(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  return `${value >= 0 ? '' : '−'}${Math.abs(value * 100).toFixed(digits)}%`
}

export function fmtDate(value: string | Date | null | undefined, withTime = false) {
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  return withTime ? date.toLocaleString('ru-RU') : date.toLocaleDateString('ru-RU')
}

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик',
  awaiting_critic: 'Ждёт критика',
  needs_review: 'Нужен разбор',
  ready_for_user: 'Готова к решению',
  user_approved: 'Одобрена',
  user_rejected: 'Отклонена',
  watching: 'Наблюдение',
  closed: 'Закрыта',
  evaluated: 'Оценена',
}

export const STATUS_COLORS: Record<string, 'neutral' | 'warning' | 'error' | 'success' | 'info' | 'primary'> = {
  draft: 'neutral',
  awaiting_critic: 'warning',
  needs_review: 'error',
  ready_for_user: 'info',
  user_approved: 'success',
  user_rejected: 'neutral',
  watching: 'primary',
  closed: 'neutral',
  evaluated: 'primary',
}

export const VERDICT_LABELS: Record<string, string> = {
  supported: 'Подтверждена',
  disputed: 'Оспорена',
  insufficient_evidence: 'Недостаточно данных',
}

export const VERDICT_COLORS: Record<string, 'success' | 'error' | 'warning'> = {
  supported: 'success',
  disputed: 'error',
  insufficient_evidence: 'warning',
}

export const STRATEGY_LABELS: Record<string, string> = {
  swing: 'Swing',
  position: 'Position',
}

export function apiError(error: unknown) {
  const e = error as {
    data?: {
      statusMessage?: string
      message?: string
    }
    statusMessage?: string
    message?: string
  }
  return e.data?.statusMessage ?? e.data?.message ?? e.statusMessage ?? e.message ?? 'Ошибка запроса'
}

export const EXIT_LABELS: Record<string, string> = {
  take_profit: 'по цели',
  stop_loss: 'по стопу',
  time_exit: 'по времени',
  not_entered: 'вход не состоялся',
  pending: 'в процессе',
}

export const ORDER_LABELS: Record<string, string> = {
  pending_confirmation: 'ждёт подтверждения',
  working: 'активна',
  filled: 'исполнена',
  cancelled: 'отменена',
  rejected: 'отклонена',
}

export const ORDER_COLORS: Record<string, 'neutral' | 'warning' | 'error' | 'success' | 'info'> = {
  pending_confirmation: 'warning',
  working: 'info',
  filled: 'success',
  cancelled: 'neutral',
  rejected: 'error',
}

export const SECTOR_LABELS: Record<string, string> = {
  financials: 'финансы',
  energy: 'энергетика',
  materials: 'сырьё',
  consumer: 'потреб',
  technology: 'технологии',
  telecom: 'телеком',
  industrials: 'промышленность',
  index: 'индекс',
  other: 'прочее',
}

import type { HypothesisStatus } from '../../../shared/types/investment'

export type DecisionAction = 'approve' | 'reject' | 'defer' | 'watch' | 'close'

const USER_DECIDABLE: HypothesisStatus[] = ['ready_for_user', 'needs_review', 'watching']

/** Allowed user transitions. Nothing reaches the user before the critic gate. */
export function nextStatusForDecision(current: HypothesisStatus, action: DecisionAction, gate?: GateInput): HypothesisStatus {
  if (action === 'close') {
    if (['user_approved', 'user_rejected', 'watching', 'ready_for_user', 'needs_review'].includes(current)) {
      return 'closed'
    }
    throw new Error(`Нельзя закрыть гипотезу в статусе ${current}`)
  }
  if (!USER_DECIDABLE.includes(current)) {
    throw new Error(`Решение недоступно в статусе ${current}`)
  }
  switch (action) {
    case 'approve':
      if (current === 'needs_review' || !gate || gateStatus(gate) !== 'ready_for_user') {
        throw new Error('Гипотеза с возражениями критика не может быть одобрена: сначала повторите проверку')
      }
      return 'user_approved'
    case 'reject': return 'user_rejected'
    case 'defer': return current
    case 'watch': return 'watching'
  }
}

export interface GateInput {
  criticVerdict: 'supported' | 'disputed' | 'insufficient_evidence' | null
  criticSucceeded: boolean
  validationOk: boolean
}

/** Hard gate: only a successful, supporting critic plus clean code validation yields ready_for_user. */
export function gateStatus({ criticVerdict, criticSucceeded, validationOk }: GateInput): HypothesisStatus {
  if (!criticSucceeded || criticVerdict === null) {
    return 'awaiting_critic'
  }
  if (criticVerdict === 'supported' && validationOk) {
    return 'ready_for_user'
  }
  return 'needs_review'
}

export function canEvaluate(status: HypothesisStatus) {
  return ['user_approved', 'user_rejected', 'watching', 'closed', 'ready_for_user', 'needs_review'].includes(status)
}

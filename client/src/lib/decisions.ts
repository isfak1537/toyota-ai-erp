import type { Decision } from '../api/types'

export const DECISION_LABEL: Record<Decision, string> = {
  ORDERED: 'Order suggested',
  NOT_NEEDED: 'No order needed',
  COVERED_BY_ON_ORDER: 'Covered by open orders',
  SKIPPED: 'Skipped',
}

export const DECISION_TONE: Record<Decision, 'ai' | 'success' | 'info' | 'warning'> = {
  ORDERED: 'ai',
  NOT_NEEDED: 'success',
  COVERED_BY_ON_ORDER: 'info',
  SKIPPED: 'warning',
}

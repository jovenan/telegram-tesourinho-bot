import type { InlineKeyboardMarkup } from 'grammy/types'

export const BUDGET_ACTIONS = {
  raise: 'budget:raise',
  cheaperModel: 'budget:cheaper_model',
  keep: 'budget:keep'
} as const

export function budgetKeyboard(raisedBudget: string, cheaperModel: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: `⬆️ Aumentar teto para ${raisedBudget}`, callback_data: BUDGET_ACTIONS.raise }],
      [{ text: `🪶 Trocar para ${cheaperModel}`, callback_data: BUDGET_ACTIONS.cheaperModel }],
      [{ text: '▶️ Continuar assim', callback_data: BUDGET_ACTIONS.keep }]
    ]
  }
}

// Approval buttons carry a token so a stale preview can't approve a newer one.
export function approvalKeyboard(token: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '✅ Confirmar', callback_data: `approve:${token}` },
        { text: '❌ Cancelar', callback_data: `reject:${token}` }
      ]
    ]
  }
}

export function parseApproval(data: string | undefined): { approved: boolean; token: string } | null {
  const match = data?.match(/^(approve|reject):(\w+)$/)
  return match ? { approved: match[1] === 'approve', token: match[2] } : null
}

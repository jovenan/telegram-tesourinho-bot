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

// Card import buttons: "bank:<action>:<token>[:<n>[:<n>]]". Items are referred to by
// their position in the batch, never by the bank's id (callback_data is capped at
// 64 bytes).
export type BankAction = 'save' | 'review' | 'ignore' | 'sug' | 'cat' | 'page' | 'same' | 'force' | 'drop' | 'skip' | 'sync'

const BANK_ACTIONS: BankAction[] = ['save', 'review', 'ignore', 'sug', 'cat', 'page', 'same', 'force', 'drop', 'skip', 'sync']
// Review buttons per page of categories (two per row).
export const CATEGORIES_PER_PAGE = 8

export function bankData(action: BankAction, token = '', ...args: number[]): string {
  return ['bank', action, token, ...args].join(':')
}

export function parseBankCallback(data: string | undefined): { action: BankAction; token: string; args: number[] } | null {
  const match = data?.match(/^bank:([a-z]+):(\w*)((?::\d+)*)$/)
  if (!match || !BANK_ACTIONS.includes(match[1] as BankAction)) return null
  return { action: match[1] as BankAction, token: match[2], args: match[3].split(':').filter(Boolean).map(Number) }
}

export function bankPreviewKeyboard(token: string, suggested: number, total: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      ...(suggested > 0 ? [[{ text: `✅ Gravar ${suggested} sugerido${suggested === 1 ? '' : 's'}`, callback_data: bankData('save', token) }]] : []),
      [{ text: `🔎 Revisar ${total}`, callback_data: bankData('review', token) }],
      [{ text: '🗑️ Ignorar lote', callback_data: bankData('ignore', token) }]
    ]
  }
}

export function bankReviewKeyboard(
  token: string,
  item: { order: number; suggestion: string | null; duplicate: unknown },
  categories: string[],
  page: number
): InlineKeyboardMarkup {
  const { order } = item
  if (item.duplicate) {
    return {
      inline_keyboard: [
        [{ text: '✔️ É o mesmo', callback_data: bankData('same', token, order) }],
        [{ text: '➕ Lançar mesmo assim', callback_data: bankData('force', token, order) }],
        [{ text: '⏭️ Pular', callback_data: bankData('skip', token, order) }]
      ]
    }
  }

  const pages = Math.max(1, Math.ceil(categories.length / CATEGORIES_PER_PAGE))
  const current = Math.min(Math.max(0, page), pages - 1)
  const start = current * CATEGORIES_PER_PAGE
  const buttons = categories.slice(start, start + CATEGORIES_PER_PAGE).map((name, i) => ({ text: name, callback_data: bankData('cat', token, order, start + i) }))
  const rows: InlineKeyboardMarkup['inline_keyboard'] = []
  if (item.suggestion) rows.push([{ text: `✅ ${item.suggestion} (sugerido)`, callback_data: bankData('sug', token, order) }])
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2))
  if (pages > 1) {
    rows.push([
      { text: '◀️', callback_data: bankData('page', token, order, (current - 1 + pages) % pages) },
      { text: `${current + 1}/${pages}`, callback_data: bankData('page', token, order, current) },
      { text: '▶️', callback_data: bankData('page', token, order, (current + 1) % pages) }
    ])
  }
  rows.push([
    { text: '🚫 Não lançar', callback_data: bankData('drop', token, order) },
    { text: '⏭️ Pular', callback_data: bankData('skip', token, order) }
  ])
  return { inline_keyboard: rows }
}

export function bankReconnectKeyboard(): InlineKeyboardMarkup {
  return { inline_keyboard: [[{ text: '🔄 Já reconectei', callback_data: bankData('sync') }]] }
}

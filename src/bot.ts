import { MESSAGES } from './config'
import { addExpense, getSources, getCategories } from './sheets'
import type { ConversationState } from './types'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''

const userState = new Map<number, ConversationState>()

export async function sendMessage(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  })
}

function formatCurrency(value: number): string {
  return `R$ ${value.toFixed(2).replace('.', ',')}`
}

export async function handleMessage(chatId: number, userId: number, text: string, firstName: string) {
  const state = userState.get(userId) || { step: 'start', data: {} }

  if (text === '/cancelar') {
    userState.set(userId, { step: 'start', data: {} })
    await sendMessage(chatId, MESSAGES.canceled)
    return
  }

  switch (state.step) {
    case 'start':
      if (text === '/start') {
        await sendMessage(chatId, MESSAGES.welcome(firstName))
      } else if (text === '/gasto') {
        state.step = 'waiting_description'
        userState.set(userId, state)
        await sendMessage(chatId, MESSAGES.newExpense)
      } else {
        await sendMessage(chatId, MESSAGES.invalidCommand)
      }
      break

    case 'waiting_description':
      state.data.description = text
      state.step = 'waiting_source'
      state.sources = await getSources()
      userState.set(userId, state)

      const sourceList = state.sources.map((s, i) => `${i + 1}. ${s}`).join('\n')
      await sendMessage(chatId, MESSAGES.sourcePrompt(sourceList))
      break

    case 'waiting_source':
      const sources = state.sources || []
      const sourceIndex = parseInt(text) - 1
      if (sourceIndex >= 0 && sourceIndex < sources.length) {
        state.data.source = sources[sourceIndex]
        state.step = 'waiting_category'
        state.categories = await getCategories()
        userState.set(userId, state)

        const categoryList = state.categories.map((cat, i) => `${i + 1}. ${cat}`).join('\n')
        await sendMessage(chatId, MESSAGES.categoryPrompt(categoryList))
      } else {
        await sendMessage(chatId, MESSAGES.invalidNumber(sources.length))
      }
      break

    case 'waiting_category':
      const categories = state.categories || []
      const catIndex = parseInt(text) - 1
      if (catIndex >= 0 && catIndex < categories.length) {
        state.data.category = categories[catIndex]
        state.step = 'waiting_value'
        userState.set(userId, state)
        await sendMessage(chatId, MESSAGES.valuePrompt)
      } else {
        await sendMessage(chatId, MESSAGES.invalidNumber(categories.length))
      }
      break

    case 'waiting_value':
      const value = parseFloat(text.replace(',', '.'))
      if (isNaN(value) || value <= 0) {
        await sendMessage(chatId, MESSAGES.invalidValue)
        return
      }

      state.data.value = value.toString()
      state.step = 'waiting_confirmation'
      userState.set(userId, state)

      await sendMessage(chatId, MESSAGES.confirmation(
        state.data.description,
        state.data.source,
        state.data.category,
        formatCurrency(value)
      ))
      break

    case 'waiting_confirmation':
      if (text.toLowerCase() === 'sim') {
        const value = parseFloat(state.data.value)
        const success = await addExpense({
          description: state.data.description,
          source: state.data.source,
          category: state.data.category,
          value: formatCurrency(value)
        })

        await sendMessage(chatId, success ? MESSAGES.success : MESSAGES.error)
        userState.set(userId, { step: 'start', data: {} })
      } else if (text.toLowerCase() === 'não' || text.toLowerCase() === 'nao') {
        userState.set(userId, { step: 'waiting_description', data: {} })
        await sendMessage(chatId, MESSAGES.restart)
      } else {
        await sendMessage(chatId, MESSAGES.invalidConfirmation)
      }
      break
  }
}

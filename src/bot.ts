import { MESSAGES, AI_MESSAGES, BOT_TOKEN } from './config'
import { addExpense, getSources, getCategories } from './sheets'
import { extractExpenseData } from './anthropic'
import { getFileUrl, getBestPhotoFileId } from './telegram'
import type { ConversationState, TelegramPhoto } from './types'

const userState = new Map<number, ConversationState>()

async function sendMessage(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  })
}

function formatCurrency(value: number): string {
  return `R$ ${value.toFixed(2).replace('.', ',')}`
}

export async function handlePhotoMessage(
  chatId: number,
  userId: number,
  photos: TelegramPhoto[],
  caption: string | undefined,
  firstName: string
): Promise<void> {
  await sendMessage(chatId, AI_MESSAGES.processing)

  const fileId = getBestPhotoFileId(photos)
  const imageUrl = await getFileUrl(fileId)

  if (!imageUrl) {
    await sendMessage(chatId, AI_MESSAGES.error)
    return
  }

  const [categories, sources] = await Promise.all([
    getCategories(),
    getSources()
  ])

  const extraction = await extractExpenseData({
    imageUrl,
    text: caption,
    categories,
    sources
  })

  if (!extraction) {
    await sendMessage(chatId, AI_MESSAGES.error)
    return
  }

  userState.set(userId, {
    step: 'waiting_ai_confirmation',
    data: {},
    sources,
    categories,
    aiExtraction: extraction
  })

  await sendMessage(chatId, AI_MESSAGES.result(extraction))
}

export async function handleMessage(chatId: number, userId: number, text: string, firstName: string) {
  const state = userState.get(userId) || { step: 'start' as const, data: {} }

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
        userState.set(userId, { step: 'waiting_description', data: {} })
        await sendMessage(chatId, MESSAGES.newExpense)
      }
      else if (text.startsWith('/ai ')) {
        const userText = text.slice(4).trim()
        if (!userText) {
          await sendMessage(chatId, AI_MESSAGES.noContent)
          return
        }

        await sendMessage(chatId, AI_MESSAGES.processing)

        const [categories, sources] = await Promise.all([
          getCategories(),
          getSources()
        ])

        const extraction = await extractExpenseData({
          text: userText,
          categories,
          sources
        })

        if (!extraction) {
          await sendMessage(chatId, AI_MESSAGES.error)
          return
        }

        userState.set(userId, {
          step: 'waiting_ai_confirmation',
          data: {},
          sources,
          categories,
          aiExtraction: extraction
        })

        await sendMessage(chatId, AI_MESSAGES.result(extraction))
      }
      else if (text === '/ai') {
        await sendMessage(chatId, AI_MESSAGES.noContent)
      }
      else {
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

    case 'waiting_ai_confirmation':
      const response = text.toLowerCase().trim()
      const extraction = state.aiExtraction!

      if (response === 'sim') {
        if (!extraction.source || !extraction.category) {
          const missing: string[] = []
          if (!extraction.source) missing.push('fonte')
          if (!extraction.category) missing.push('categoria')
          await sendMessage(chatId, AI_MESSAGES.missingFields(missing))
          return
        }

        const formattedValue = formatCurrency(extraction.value)

        const success = await addExpense({
          description: extraction.description,
          source: extraction.source,
          category: extraction.category,
          value: formattedValue
        })

        await sendMessage(chatId, success ? MESSAGES.success : MESSAGES.error)
        userState.set(userId, { step: 'start', data: {} })
      }
      else if (response === 'não' || response === 'nao') {
        await sendMessage(chatId, MESSAGES.canceled)
        userState.set(userId, { step: 'start', data: {} })
      }
      else if (response === 'editar') {
        userState.set(userId, {
          step: 'waiting_description',
          data: {
            description: extraction.description,
            value: extraction.value.toString()
          },
          sources: state.sources,
          categories: state.categories
        })
        await sendMessage(chatId, AI_MESSAGES.editPrompt)
      }
      else {
        await sendMessage(chatId, MESSAGES.invalidConfirmation)
      }
      break
  }
}

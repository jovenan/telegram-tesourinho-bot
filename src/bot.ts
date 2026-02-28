import { MESSAGES, AI_MESSAGES } from './config'
import { addExpense, getSources, getCategories } from './sheets'
import { extractExpenseData } from './anthropic'
import { getFileUrl, getBestPhotoFileId } from './telegram'
import type { Env, ConversationState, TelegramPhoto, InlineKeyboardMarkup } from './types'

const userState = new Map<number, ConversationState>()

async function sendMessage(env: Env, chatId: number, text: string, replyMarkup?: InlineKeyboardMarkup) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: replyMarkup
    })
  })
}

async function answerCallbackQuery(env: Env, callbackQueryId: string, text?: string) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text
    })
  })
}

async function editMessageText(env: Env, chatId: number, messageId: number, text: string, replyMarkup?: InlineKeyboardMarkup) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      reply_markup: replyMarkup
    })
  })
}

function formatCurrency(value: number): string {
  return `R$ ${value.toFixed(2).replace('.', ',')}`
}

const confirmationButtons: InlineKeyboardMarkup = {
  inline_keyboard: [
    [
      { text: '✅ Confirmar', callback_data: 'confirm' },
      { text: '❌ Pular', callback_data: 'skip' },
      { text: '✏️ Editar', callback_data: 'edit' }
    ]
  ]
}

const editFieldButtons: InlineKeyboardMarkup = {
  inline_keyboard: [
    [
      { text: '📝 Descrição', callback_data: 'edit_description' },
      { text: '💵 Valor', callback_data: 'edit_value' }
    ],
    [
      { text: '🏦 Fonte', callback_data: 'edit_source' },
      { text: '📁 Categoria', callback_data: 'edit_category' }
    ],
    [
      { text: '🔄 Tudo', callback_data: 'edit_all' },
      { text: '↩️ Voltar', callback_data: 'edit_back' }
    ]
  ]
}

export async function handlePhotoMessage(
  env: Env,
  chatId: number,
  userId: number,
  photos: TelegramPhoto[],
  caption: string | undefined
): Promise<void> {
  await sendMessage(env, chatId, AI_MESSAGES.processing)

  const fileId = getBestPhotoFileId(photos)
  const imageUrl = await getFileUrl(env, fileId)

  if (!imageUrl) {
    await sendMessage(env, chatId, AI_MESSAGES.error)
    return
  }

  const [categories, sources] = await Promise.all([
    getCategories(),
    getSources(env)
  ])

  const extractions = await extractExpenseData({
    env,
    imageUrl,
    text: caption,
    categories,
    sources
  })

  if (!extractions || extractions.length === 0) {
    await sendMessage(env, chatId, AI_MESSAGES.error)
    return
  }

  userState.set(userId, {
    step: 'waiting_ai_confirmation',
    data: { savedCount: '0' },
    sources,
    categories,
    aiExtractions: extractions,
    currentExtractionIndex: 0
  })

  if (extractions.length > 1) {
    await sendMessage(env, chatId, AI_MESSAGES.foundMultiple(extractions.length))
  }

  const message = AI_MESSAGES.result(extractions[0], 1, extractions.length) + AI_MESSAGES.resultWithAddOption
  await sendMessage(env, chatId, message, confirmationButtons)
}

export async function handleMessage(env: Env, chatId: number, userId: number, text: string, firstName: string) {
  const state = userState.get(userId) || { step: 'start' as const, data: {} }

  if (text === '/cancelar') {
    userState.set(userId, { step: 'start', data: {} })
    await sendMessage(env, chatId, MESSAGES.canceled)
    return
  }

  switch (state.step) {
    case 'start':
      if (text === '/start') {
        await sendMessage(env, chatId, MESSAGES.welcome(firstName))
      } else if (text === '/gasto') {
        userState.set(userId, { step: 'waiting_description', data: {} })
        await sendMessage(env, chatId, MESSAGES.newExpense)
      }
      else if (text.startsWith('/ai ')) {
        const userText = text.slice(4).trim()
        if (!userText) {
          await sendMessage(env, chatId, AI_MESSAGES.noContent)
          return
        }

        await sendMessage(env, chatId, AI_MESSAGES.processing)

        const [categories, sources] = await Promise.all([
          getCategories(),
          getSources(env)
        ])

        const extractions = await extractExpenseData({
          env,
          text: userText,
          categories,
          sources
        })

        if (!extractions || extractions.length === 0) {
          await sendMessage(env, chatId, AI_MESSAGES.error)
          return
        }

        userState.set(userId, {
          step: 'waiting_ai_confirmation',
          data: { savedCount: '0' },
          sources,
          categories,
          aiExtractions: extractions,
          currentExtractionIndex: 0
        })

        if (extractions.length > 1) {
          await sendMessage(env, chatId, AI_MESSAGES.foundMultiple(extractions.length))
        }

        const message = AI_MESSAGES.result(extractions[0], 1, extractions.length) + AI_MESSAGES.resultWithAddOption
        await sendMessage(env, chatId, message, confirmationButtons)
      }
      else if (text === '/ai') {
        await sendMessage(env, chatId, AI_MESSAGES.noContent)
      }
      else {
        await sendMessage(env, chatId, MESSAGES.invalidCommand)
      }
      break

    case 'waiting_description':
      state.data.description = text
      state.step = 'waiting_source'
      state.sources = await getSources(env)
      userState.set(userId, state)

      const sourceList = state.sources.map((s, i) => `${i + 1}. ${s}`).join('\n')
      await sendMessage(env, chatId, MESSAGES.sourcePrompt(sourceList))
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
        await sendMessage(env, chatId, MESSAGES.categoryPrompt(categoryList))
      } else {
        await sendMessage(env, chatId, MESSAGES.invalidNumber(sources.length))
      }
      break

    case 'waiting_category':
      const categories = state.categories || []
      const catIndex = parseInt(text) - 1
      if (catIndex >= 0 && catIndex < categories.length) {
        state.data.category = categories[catIndex]
        state.step = 'waiting_value'
        userState.set(userId, state)
        await sendMessage(env, chatId, MESSAGES.valuePrompt)
      } else {
        await sendMessage(env, chatId, MESSAGES.invalidNumber(categories.length))
      }
      break

    case 'waiting_value':
      const value = parseFloat(text.replace(',', '.'))
      if (isNaN(value) || value <= 0) {
        await sendMessage(env, chatId, MESSAGES.invalidValue)
        return
      }

      state.data.value = value.toString()
      state.step = 'waiting_confirmation'
      userState.set(userId, state)

      await sendMessage(env, chatId, MESSAGES.confirmation(
        state.data.description,
        state.data.source,
        state.data.category,
        formatCurrency(value)
      ))
      break

    case 'waiting_confirmation':
      if (text.toLowerCase() === 'sim') {
        const value = parseFloat(state.data.value)
        const success = await addExpense(env, {
          description: state.data.description,
          source: state.data.source,
          category: state.data.category,
          value: formatCurrency(value)
        })

        await sendMessage(env, chatId, success ? MESSAGES.success : MESSAGES.error)
        userState.set(userId, { step: 'start', data: {} })
      } else if (text.toLowerCase() === 'não' || text.toLowerCase() === 'nao') {
        userState.set(userId, { step: 'waiting_description', data: {} })
        await sendMessage(env, chatId, MESSAGES.restart)
      } else {
        await sendMessage(env, chatId, MESSAGES.invalidConfirmation)
      }
      break

    case 'waiting_ai_confirmation':
      const response = text.toLowerCase().trim()
      const extractions = state.aiExtractions || []
      const currentIndex = state.currentExtractionIndex || 0
      const extraction = extractions[currentIndex]
      let savedCount = parseInt(state.data.savedCount || '0')

      if (!extraction) {
        userState.set(userId, { step: 'start', data: {} })
        return
      }

      const goToNext = async () => {
        const nextIndex = currentIndex + 1
        if (nextIndex < extractions.length) {
          userState.set(userId, {
            ...state,
            currentExtractionIndex: nextIndex,
            data: { ...state.data, savedCount: savedCount.toString() }
          })
          const message = AI_MESSAGES.result(extractions[nextIndex], nextIndex + 1, extractions.length) + AI_MESSAGES.resultWithAddOption
          await sendMessage(env, chatId, message, confirmationButtons)
        } else {
          await sendMessage(env, chatId, AI_MESSAGES.allDone(savedCount, extractions.length))
          userState.set(userId, { step: 'start', data: {} })
        }
      }

      const isAddDescription = response.startsWith('add ') || response.startsWith('adicionar ')

      if (response === 'sim' || isAddDescription) {
        if (!extraction.source || !extraction.category) {
          const missing: string[] = []
          if (!extraction.source) missing.push('fonte')
          if (!extraction.category) missing.push('categoria')
          await sendMessage(env, chatId, AI_MESSAGES.missingFields(missing))
          return
        }

        let finalDescription = extraction.description
        if (isAddDescription) {
          const suffix = response.startsWith('add ')
            ? text.slice(4).trim()
            : text.slice(10).trim()
          finalDescription = `${extraction.description} - ${suffix}`
        }

        const formattedValue = formatCurrency(extraction.value)

        const success = await addExpense(env, {
          description: `${finalDescription} - AI GENERATED`,
          source: extraction.source,
          category: extraction.category,
          value: formattedValue
        })

        if (success) {
          savedCount++
          state.data.savedCount = savedCount.toString()
        }

        if (extractions.length === 1) {
          await sendMessage(env, chatId, success ? MESSAGES.success : MESSAGES.error)
          userState.set(userId, { step: 'start', data: {} })
        } else {
          if (success) {
            await sendMessage(env, chatId, '✅ Salvo!')
          } else {
            await sendMessage(env, chatId, '❌ Erro ao salvar este gasto.')
          }
          await goToNext()
        }
      }
      else if (response === 'não' || response === 'nao') {
        if (extractions.length === 1) {
          await sendMessage(env, chatId, MESSAGES.canceled)
          userState.set(userId, { step: 'start', data: {} })
        } else {
          await sendMessage(env, chatId, '⏭️ Pulando...')
          await goToNext()
        }
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
        await sendMessage(env, chatId, AI_MESSAGES.editPrompt)
      }
      else {
        await sendMessage(env, chatId, MESSAGES.invalidConfirmation)
      }
      break

    case 'editing_description':
      const newDescription = text.trim()
      if (newDescription) {
        const extractionsEdit = state.aiExtractions || []
        const indexEdit = state.currentExtractionIndex || 0
        extractionsEdit[indexEdit].description = newDescription

        userState.set(userId, {
          ...state,
          step: 'waiting_ai_confirmation',
          aiExtractions: extractionsEdit
        })

        const message = AI_MESSAGES.result(extractionsEdit[indexEdit], indexEdit + 1, extractionsEdit.length) + AI_MESSAGES.resultWithAddOption
        await sendMessage(env, chatId, message, confirmationButtons)
      }
      break

    case 'editing_value':
      const newValue = parseFloat(text.replace(',', '.'))
      if (isNaN(newValue) || newValue <= 0) {
        await sendMessage(env, chatId, MESSAGES.invalidValue)
        return
      }

      const extractionsVal = state.aiExtractions || []
      const indexVal = state.currentExtractionIndex || 0
      extractionsVal[indexVal].value = newValue

      userState.set(userId, {
        ...state,
        step: 'waiting_ai_confirmation',
        aiExtractions: extractionsVal
      })

      const messageVal = AI_MESSAGES.result(extractionsVal[indexVal], indexVal + 1, extractionsVal.length) + AI_MESSAGES.resultWithAddOption
      await sendMessage(env, chatId, messageVal, confirmationButtons)
      break

    case 'editing_source':
      const sourcesEdit = state.sources || []
      const sourceIdx = parseInt(text) - 1
      if (sourceIdx >= 0 && sourceIdx < sourcesEdit.length) {
        const extractionsSrc = state.aiExtractions || []
        const indexSrc = state.currentExtractionIndex || 0
        extractionsSrc[indexSrc].source = sourcesEdit[sourceIdx]

        userState.set(userId, {
          ...state,
          step: 'waiting_ai_confirmation',
          aiExtractions: extractionsSrc
        })

        const messageSrc = AI_MESSAGES.result(extractionsSrc[indexSrc], indexSrc + 1, extractionsSrc.length) + AI_MESSAGES.resultWithAddOption
        await sendMessage(env, chatId, messageSrc, confirmationButtons)
      } else {
        await sendMessage(env, chatId, MESSAGES.invalidNumber(sourcesEdit.length))
      }
      break

    case 'editing_category':
      const categoriesEdit = state.categories || []
      const catIdx = parseInt(text) - 1
      if (catIdx >= 0 && catIdx < categoriesEdit.length) {
        const extractionsCat = state.aiExtractions || []
        const indexCat = state.currentExtractionIndex || 0
        extractionsCat[indexCat].category = categoriesEdit[catIdx]

        userState.set(userId, {
          ...state,
          step: 'waiting_ai_confirmation',
          aiExtractions: extractionsCat
        })

        const messageCat = AI_MESSAGES.result(extractionsCat[indexCat], indexCat + 1, extractionsCat.length) + AI_MESSAGES.resultWithAddOption
        await sendMessage(env, chatId, messageCat, confirmationButtons)
      } else {
        await sendMessage(env, chatId, MESSAGES.invalidNumber(categoriesEdit.length))
      }
      break
  }
}

export async function handleCallbackQuery(
  env: Env,
  callbackQueryId: string,
  chatId: number,
  messageId: number,
  userId: number,
  data: string
): Promise<void> {
  const state = userState.get(userId)

  if (!state || state.step !== 'waiting_ai_confirmation') {
    await answerCallbackQuery(env, callbackQueryId, 'Sessão expirada')
    return
  }

  const extractions = state.aiExtractions || []
  const currentIndex = state.currentExtractionIndex || 0
  const extraction = extractions[currentIndex]
  let savedCount = parseInt(state.data.savedCount || '0')

  if (!extraction) {
    await answerCallbackQuery(env, callbackQueryId)
    userState.set(userId, { step: 'start', data: {} })
    return
  }

  const goToNextWithButtons = async () => {
    const nextIndex = currentIndex + 1
    if (nextIndex < extractions.length) {
      userState.set(userId, {
        ...state,
        currentExtractionIndex: nextIndex,
        data: { ...state.data, savedCount: savedCount.toString() }
      })
      const message = AI_MESSAGES.result(extractions[nextIndex], nextIndex + 1, extractions.length) + AI_MESSAGES.resultWithAddOption
      await sendMessage(env, chatId, message, confirmationButtons)
    } else {
      await sendMessage(env, chatId, AI_MESSAGES.allDone(savedCount, extractions.length))
      userState.set(userId, { step: 'start', data: {} })
    }
  }

  if (data === 'confirm') {
    if (!extraction.source || !extraction.category) {
      const missing: string[] = []
      if (!extraction.source) missing.push('fonte')
      if (!extraction.category) missing.push('categoria')
      await answerCallbackQuery(env, callbackQueryId, 'Campos faltando!')
      await sendMessage(env, chatId, AI_MESSAGES.missingFields(missing))
      return
    }

    const formattedValue = formatCurrency(extraction.value)

    const success = await addExpense(env, {
      description: `${extraction.description} - AI GENERATED`,
      source: extraction.source,
      category: extraction.category,
      value: formattedValue
    })

    if (success) {
      savedCount++
      state.data.savedCount = savedCount.toString()
    }

    await editMessageText(env, chatId, messageId, AI_MESSAGES.result(extraction, currentIndex + 1, extractions.length) + (success ? '\n\n✅ <b>Salvo!</b>' : '\n\n❌ <b>Erro ao salvar</b>'))
    await answerCallbackQuery(env, callbackQueryId, success ? 'Salvo!' : 'Erro ao salvar')

    if (extractions.length === 1) {
      userState.set(userId, { step: 'start', data: {} })
    } else {
      await goToNextWithButtons()
    }
  }
  else if (data === 'skip') {
    await editMessageText(env, chatId, messageId, AI_MESSAGES.result(extraction, currentIndex + 1, extractions.length) + '\n\n⏭️ <b>Pulado</b>')
    await answerCallbackQuery(env, callbackQueryId, 'Pulado')

    if (extractions.length === 1) {
      userState.set(userId, { step: 'start', data: {} })
    } else {
      await goToNextWithButtons()
    }
  }
  else if (data === 'edit') {
    await editMessageText(
      env,
      chatId,
      messageId,
      AI_MESSAGES.result(extraction, currentIndex + 1, extractions.length) + '\n\n✏️ <b>O que deseja editar?</b>',
      editFieldButtons
    )
    await answerCallbackQuery(env, callbackQueryId)
  }
  else if (data === 'edit_back') {
    const message = AI_MESSAGES.result(extraction, currentIndex + 1, extractions.length) + AI_MESSAGES.resultWithAddOption
    await editMessageText(env, chatId, messageId, message, confirmationButtons)
    await answerCallbackQuery(env, callbackQueryId)
  }
  else if (data === 'edit_description') {
    await answerCallbackQuery(env, callbackQueryId)
    userState.set(userId, {
      ...state,
      step: 'editing_description'
    })
    await sendMessage(env, chatId, '📝 Digite a nova descrição:')
  }
  else if (data === 'edit_value') {
    await answerCallbackQuery(env, callbackQueryId)
    userState.set(userId, {
      ...state,
      step: 'editing_value'
    })
    await sendMessage(env, chatId, '💵 Digite o novo valor (ex: 29.90 ou 29,90):')
  }
  else if (data === 'edit_source') {
    await answerCallbackQuery(env, callbackQueryId)
    const sources = state.sources || await getSources(env)
    userState.set(userId, {
      ...state,
      step: 'editing_source',
      sources
    })
    const sourceList = sources.map((s, i) => `${i + 1}. ${s}`).join('\n')
    await sendMessage(env, chatId, `🏦 Escolha a fonte:\n\n${sourceList}`)
  }
  else if (data === 'edit_category') {
    await answerCallbackQuery(env, callbackQueryId)
    const categories = state.categories || await getCategories()
    userState.set(userId, {
      ...state,
      step: 'editing_category',
      categories
    })
    const categoryList = categories.map((c, i) => `${i + 1}. ${c}`).join('\n')
    await sendMessage(env, chatId, `📁 Escolha a categoria:\n\n${categoryList}`)
  }
  else if (data === 'edit_all') {
    await editMessageText(env, chatId, messageId, AI_MESSAGES.result(extraction, currentIndex + 1, extractions.length) + '\n\n✏️ <b>Editando tudo...</b>')
    await answerCallbackQuery(env, callbackQueryId)

    userState.set(userId, {
      step: 'waiting_description',
      data: {
        description: extraction.description,
        value: extraction.value.toString()
      },
      sources: state.sources,
      categories: state.categories
    })
    await sendMessage(env, chatId, AI_MESSAGES.editPrompt)
  }
}

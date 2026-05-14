import { MESSAGES, AI_MESSAGES } from './config'
import { addExpense, addTravelExpense, getTravelExpenses, getSources, getCategories } from './sheets'
import { extractExpenseData, extractTravelExpenseData } from './anthropic'
import { getFileUrl, getBestPhotoFileId } from './telegram'
import type { Env, ConversationState, TelegramPhoto, InlineKeyboardMarkup, TravelExpenseExtraction, ExpenseExtraction, TravelExpense } from './types'

const userState = new Map<number, ConversationState>()
const travelMode = new Map<number, boolean>()

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

function formatNumber(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function getMessageDate(messageDate?: number, timeZone = 'America/Sao_Paulo'): string {
  const date = messageDate ? new Date(messageDate * 1000) : new Date()
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

function getTravelMessageDate(messageDate?: number): string {
  return getMessageDate(messageDate, 'Europe/Rome')
}

function normalizeDate(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback

  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed

  const brDate = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (brDate) {
    const [, day, month, year] = brDate
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  return fallback
}

function formatDateForDisplay(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return value
  const [, year, month, day] = match
  return `${day}/${month}/${year}`
}

function isTravelExtraction(extraction: ExpenseExtraction | TravelExpenseExtraction): extraction is TravelExpenseExtraction {
  return 'country' in extraction || 'city' in extraction || 'date' in extraction
}

function travelResultMessage(
  data: TravelExpenseExtraction,
  person: string,
  fallbackDate: string,
  current?: number,
  total?: number
): string {
  const header = total && total > 1
    ? `📋 <b>Gasto de viagem ${current}/${total}:</b>`
    : `📋 <b>Dados de viagem extraídos:</b>`
  return `${header}

📅 <b>Data:</b> ${formatDateForDisplay(normalizeDate(data.date, fallbackDate))}
🌍 <b>País:</b> ${data.country || '⚠️ Não identificado'}
🏙️ <b>Cidade:</b> ${data.city || '⚠️ Não identificada'}
👤 <b>Pessoa:</b> ${person}
📝 <b>Descrição:</b> ${data.description}
🏦 <b>Fonte:</b> ${data.source || '⚠️ Não identificada'}
📁 <b>Categoria:</b> ${data.category || '⚠️ Não identificada'}
💵 <b>Valor:</b> ${formatNumber(data.value)}`
}

function resultMessage(state: ConversationState, extraction: ExpenseExtraction | TravelExpenseExtraction, current: number, total: number): string {
  if (state.isTravel && isTravelExtraction(extraction)) {
    return travelResultMessage(extraction, state.person || 'Não identificado', getTravelMessageDate(state.messageDate), current, total)
  }

  return AI_MESSAGES.result(extraction, current, total)
}

type TravelGroupKey = 'date' | 'country' | 'city' | 'person' | 'category'

const travelGroupLabels: Record<TravelGroupKey, string> = {
  date: 'dia',
  country: 'país',
  city: 'cidade',
  person: 'pessoa',
  category: 'categoria'
}

function getTravelExpenseValue(expense: TravelExpense): number {
  return typeof expense.value === 'number' ? expense.value : Number(expense.value) || 0
}

function buildTravelSummary(expenses: TravelExpense[], groupKey?: TravelGroupKey): string {
  if (expenses.length === 0) {
    return 'Não encontrei gastos de viagem salvos.'
  }

  const total = expenses.reduce((sum, expense) => sum + getTravelExpenseValue(expense), 0)

  if (!groupKey) {
    return `Total de gastos de viagem: ${formatNumber(total)}`
  }

  const groups = new Map<string, number>()
  for (const expense of expenses) {
    const rawKey = expense[groupKey]
    const key = rawKey ? String(rawKey) : 'Não identificado'
    groups.set(key, (groups.get(key) || 0) + getTravelExpenseValue(expense))
  }

  const rows = Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
    .map(([key, value]) => {
      const label = groupKey === 'date' ? formatDateForDisplay(key) : key
      return `${label}: ${formatNumber(value)}`
    })
    .join('\n')

  return `Gastos por ${travelGroupLabels[groupKey]}:\n\n${rows}\n\nTotal: ${formatNumber(total)}`
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function filterTravelExpensesByToday(expenses: TravelExpense[]): TravelExpense[] {
  const today = getMessageDate()
  return expenses.filter((expense) => expense.date === today)
}

async function sendTravelSummary(env: Env, chatId: number, groupKey?: TravelGroupKey, onlyToday = false): Promise<void> {
  const expenses = await getTravelExpenses(env)
  const filtered = onlyToday ? filterTravelExpensesByToday(expenses) : expenses
  await sendMessage(env, chatId, buildTravelSummary(filtered, groupKey))
}

async function maybeHandleTravelQuestion(env: Env, chatId: number, text: string): Promise<boolean> {
  const normalized = normalizeText(text)

  if (!normalized.includes('quanto') && !normalized.includes('gastei') && !normalized.includes('gastamos')) {
    return false
  }

  if (normalized.includes('por dia')) {
    await sendTravelSummary(env, chatId, 'date')
    return true
  }

  if (normalized.includes('por pessoa')) {
    await sendTravelSummary(env, chatId, 'person')
    return true
  }

  if (normalized.includes('por pais')) {
    await sendTravelSummary(env, chatId, 'country')
    return true
  }

  if (normalized.includes('por cidade')) {
    await sendTravelSummary(env, chatId, 'city')
    return true
  }

  if (normalized.includes('por categoria')) {
    await sendTravelSummary(env, chatId, 'category')
    return true
  }

  const expenses = await getTravelExpenses(env)
  const matchingCountry = expenses.find((expense) => expense.country && normalized.includes(normalizeText(expense.country)))
  if (matchingCountry) {
    const country = matchingCountry.country
    await sendMessage(env, chatId, buildTravelSummary(expenses.filter((expense) => expense.country === country)))
    return true
  }

  const matchingCity = expenses.find((expense) => expense.city && normalized.includes(normalizeText(expense.city)))
  if (matchingCity) {
    const city = matchingCity.city
    await sendMessage(env, chatId, buildTravelSummary(expenses.filter((expense) => expense.city === city)))
    return true
  }

  const matchingPerson = expenses.find((expense) => expense.person && normalized.includes(normalizeText(expense.person)))
  if (matchingPerson) {
    const person = matchingPerson.person
    await sendMessage(env, chatId, buildTravelSummary(expenses.filter((expense) => expense.person === person)))
    return true
  }

  return false
}

async function saveExtraction(env: Env, state: ConversationState, extraction: ExpenseExtraction | TravelExpenseExtraction): Promise<boolean> {
  if (state.isTravel && isTravelExtraction(extraction)) {
    const fallbackDate = getTravelMessageDate(state.messageDate)
    return addTravelExpense(env, {
      date: normalizeDate(extraction.date, fallbackDate),
      country: extraction.country || 'Não identificado',
      city: extraction.city || 'Não identificada',
      person: state.person || 'Não identificado',
      description: `${extraction.description} - AI GENERATED`,
      source: extraction.source || '',
      category: extraction.category || '',
      value: extraction.value
    })
  }

  return addExpense(env, {
    description: `${extraction.description} - AI GENERATED`,
    source: extraction.source || '',
    category: extraction.category || '',
    value: extraction.value
  })
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

const travelEditFieldButtons: InlineKeyboardMarkup = {
  inline_keyboard: [
    [
      { text: '📅 Data', callback_data: 'edit_travel_date' },
      { text: '🌍 País', callback_data: 'edit_travel_country' },
      { text: '🏙️ Cidade', callback_data: 'edit_travel_city' }
    ],
    [
      { text: '📝 Descrição', callback_data: 'edit_description' },
      { text: '💵 Valor', callback_data: 'edit_value' }
    ],
    [
      { text: '🏦 Fonte', callback_data: 'edit_source' },
      { text: '📁 Categoria', callback_data: 'edit_category' }
    ],
    [
      { text: '↩️ Voltar', callback_data: 'edit_back' }
    ]
  ]
}

export async function handlePhotoMessage(
  env: Env,
  chatId: number,
  userId: number,
  firstName: string,
  messageDate: number,
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

  const isTravel = travelMode.get(userId) === true
  console.log('Processing photo message:', JSON.stringify({
    chatId,
    userId,
    firstName,
    isTravel,
    hasCaption: Boolean(caption)
  }))

  const extractions = isTravel
    ? await extractTravelExpenseData({
      env,
      imageUrl,
      text: caption,
      categories,
      sources
    })
    : await extractExpenseData({
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

  const nextState: ConversationState = {
    step: 'waiting_ai_confirmation',
    data: { savedCount: '0' },
    sources,
    categories,
    aiExtractions: extractions,
    currentExtractionIndex: 0,
    isTravel,
    person: firstName,
    messageDate
  }
  userState.set(userId, nextState)

  if (extractions.length > 1) {
    await sendMessage(env, chatId, AI_MESSAGES.foundMultiple(extractions.length))
  }

  const message = resultMessage(nextState, extractions[0], 1, extractions.length) + AI_MESSAGES.resultWithAddOption
  await sendMessage(env, chatId, message, confirmationButtons)
}

export async function handleMessage(env: Env, chatId: number, userId: number, text: string, firstName: string) {
  const state = userState.get(userId) || { step: 'start' as const, data: {} }

  if (text === '/cancelar') {
    userState.set(userId, { step: 'start', data: {} })
    await sendMessage(env, chatId, MESSAGES.canceled)
    return
  }

  if (text === '/viagem_on') {
    travelMode.set(userId, true)
    console.log('Travel mode enabled:', JSON.stringify({ chatId, userId, firstName }))
    userState.set(userId, { step: 'start', data: {} })
    await sendMessage(env, chatId, 'Modo viagem ativado. As próximas fotos serão salvas na aba Viagem Europa.')
    return
  }

  if (text === '/viagem_off') {
    travelMode.set(userId, false)
    console.log('Travel mode disabled:', JSON.stringify({ chatId, userId, firstName }))
    userState.set(userId, { step: 'start', data: {} })
    await sendMessage(env, chatId, 'Modo viagem desativado. As próximas fotos voltam para o fluxo normal.')
    return
  }

  if (text === '/viagem_status') {
    const enabled = travelMode.get(userId) === true
    await sendMessage(env, chatId, enabled ? 'Modo viagem está ativado.' : 'Modo viagem está desativado.')
    return
  }

  if (text === '/viagem_hoje') {
    await sendTravelSummary(env, chatId, undefined, true)
    return
  }

  if (text === '/viagem_dias') {
    await sendTravelSummary(env, chatId, 'date')
    return
  }

  if (text === '/viagem_paises') {
    await sendTravelSummary(env, chatId, 'country')
    return
  }

  if (text === '/viagem_cidades') {
    await sendTravelSummary(env, chatId, 'city')
    return
  }

  if (text === '/viagem_pessoas') {
    await sendTravelSummary(env, chatId, 'person')
    return
  }

  if (text === '/viagem_categorias') {
    await sendTravelSummary(env, chatId, 'category')
    return
  }

  if (state.step === 'start' && await maybeHandleTravelQuestion(env, chatId, text)) {
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

        const nextState: ConversationState = {
          step: 'waiting_ai_confirmation',
          data: { savedCount: '0' },
          sources,
          categories,
          aiExtractions: extractions,
          currentExtractionIndex: 0
        }
        userState.set(userId, nextState)

        if (extractions.length > 1) {
          await sendMessage(env, chatId, AI_MESSAGES.foundMultiple(extractions.length))
        }

        const message = resultMessage(nextState, extractions[0], 1, extractions.length) + AI_MESSAGES.resultWithAddOption
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
          value
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
          const message = resultMessage(state, extractions[nextIndex], nextIndex + 1, extractions.length) + AI_MESSAGES.resultWithAddOption
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

        const extractionToSave = { ...extraction, description: finalDescription }
        const success = await saveExtraction(env, state, extractionToSave)

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

        const message = resultMessage(state, extractionsEdit[indexEdit], indexEdit + 1, extractionsEdit.length) + AI_MESSAGES.resultWithAddOption
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

      const messageVal = resultMessage(state, extractionsVal[indexVal], indexVal + 1, extractionsVal.length) + AI_MESSAGES.resultWithAddOption
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

        const messageSrc = resultMessage(state, extractionsSrc[indexSrc], indexSrc + 1, extractionsSrc.length) + AI_MESSAGES.resultWithAddOption
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

        const messageCat = resultMessage(state, extractionsCat[indexCat], indexCat + 1, extractionsCat.length) + AI_MESSAGES.resultWithAddOption
        await sendMessage(env, chatId, messageCat, confirmationButtons)
      } else {
        await sendMessage(env, chatId, MESSAGES.invalidNumber(categoriesEdit.length))
      }
      break

    case 'editing_travel_date':
      const extractionsDate = state.aiExtractions || []
      const indexDate = state.currentExtractionIndex || 0
      if (isTravelExtraction(extractionsDate[indexDate])) {
        extractionsDate[indexDate].date = normalizeDate(text, getMessageDate(state.messageDate))
      }

      userState.set(userId, {
        ...state,
        step: 'waiting_ai_confirmation',
        aiExtractions: extractionsDate
      })

      await sendMessage(env, chatId, resultMessage(state, extractionsDate[indexDate], indexDate + 1, extractionsDate.length) + AI_MESSAGES.resultWithAddOption, confirmationButtons)
      break

    case 'editing_travel_country':
      const extractionsCountry = state.aiExtractions || []
      const indexCountry = state.currentExtractionIndex || 0
      if (isTravelExtraction(extractionsCountry[indexCountry])) {
        extractionsCountry[indexCountry].country = text.trim()
      }

      userState.set(userId, {
        ...state,
        step: 'waiting_ai_confirmation',
        aiExtractions: extractionsCountry
      })

      await sendMessage(env, chatId, resultMessage(state, extractionsCountry[indexCountry], indexCountry + 1, extractionsCountry.length) + AI_MESSAGES.resultWithAddOption, confirmationButtons)
      break

    case 'editing_travel_city':
      const extractionsCity = state.aiExtractions || []
      const indexCity = state.currentExtractionIndex || 0
      if (isTravelExtraction(extractionsCity[indexCity])) {
        extractionsCity[indexCity].city = text.trim()
      }

      userState.set(userId, {
        ...state,
        step: 'waiting_ai_confirmation',
        aiExtractions: extractionsCity
      })

      await sendMessage(env, chatId, resultMessage(state, extractionsCity[indexCity], indexCity + 1, extractionsCity.length) + AI_MESSAGES.resultWithAddOption, confirmationButtons)
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
      const message = resultMessage(state, extractions[nextIndex], nextIndex + 1, extractions.length) + AI_MESSAGES.resultWithAddOption
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

    const success = await saveExtraction(env, state, extraction)

    if (success) {
      savedCount++
      state.data.savedCount = savedCount.toString()
    }

    await editMessageText(env, chatId, messageId, resultMessage(state, extraction, currentIndex + 1, extractions.length) + (success ? '\n\n✅ <b>Salvo!</b>' : '\n\n❌ <b>Erro ao salvar</b>'))
    await answerCallbackQuery(env, callbackQueryId, success ? 'Salvo!' : 'Erro ao salvar')

    if (extractions.length === 1) {
      userState.set(userId, { step: 'start', data: {} })
    } else {
      await goToNextWithButtons()
    }
  }
  else if (data === 'skip') {
    await editMessageText(env, chatId, messageId, resultMessage(state, extraction, currentIndex + 1, extractions.length) + '\n\n⏭️ <b>Pulado</b>')
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
      resultMessage(state, extraction, currentIndex + 1, extractions.length) + '\n\n✏️ <b>O que deseja editar?</b>',
      state.isTravel ? travelEditFieldButtons : editFieldButtons
    )
    await answerCallbackQuery(env, callbackQueryId)
  }
  else if (data === 'edit_back') {
    const message = resultMessage(state, extraction, currentIndex + 1, extractions.length) + AI_MESSAGES.resultWithAddOption
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
  else if (data === 'edit_travel_date') {
    await answerCallbackQuery(env, callbackQueryId)
    userState.set(userId, {
      ...state,
      step: 'editing_travel_date'
    })
    await sendMessage(env, chatId, '📅 Digite a data no formato AAAA-MM-DD ou DD/MM/AAAA:')
  }
  else if (data === 'edit_travel_country') {
    await answerCallbackQuery(env, callbackQueryId)
    userState.set(userId, {
      ...state,
      step: 'editing_travel_country'
    })
    await sendMessage(env, chatId, '🌍 Digite o país:')
  }
  else if (data === 'edit_travel_city') {
    await answerCallbackQuery(env, callbackQueryId)
    userState.set(userId, {
      ...state,
      step: 'editing_travel_city'
    })
    await sendMessage(env, chatId, '🏙️ Digite a cidade:')
  }
  else if (data === 'edit_all') {
    await editMessageText(env, chatId, messageId, resultMessage(state, extraction, currentIndex + 1, extractions.length) + '\n\n✏️ <b>Editando tudo...</b>')
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

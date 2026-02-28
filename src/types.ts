export interface Env {
  TELEGRAM_BOT_TOKEN: string
  TELEGRAM_WEBHOOK_SECRET: string
  ANTHROPIC_API_KEY: string
  GOOGLE_CLIENT_EMAIL: string
  GOOGLE_PRIVATE_KEY: string
  GOOGLE_SPREADSHEET_ID: string
  GOOGLE_SHEET_NAME: string
}

export interface ExpenseExtraction {
  description: string
  category: string | null
  source: string | null
  value: number
}

export interface TelegramPhoto {
  file_id: string
  file_unique_id: string
  width: number
  height: number
  file_size?: number
}

export interface TelegramMessage {
  message_id: number
  from: {
    id: number
    first_name: string
    username?: string
  }
  chat: {
    id: number
    type: string
  }
  date: number
  text?: string
  photo?: TelegramPhoto[]
  caption?: string
}

export interface TelegramCallbackQuery {
  id: string
  from: {
    id: number
    first_name: string
    username?: string
  }
  message?: TelegramMessage
  data?: string
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  callback_query?: TelegramCallbackQuery
}

export interface ConversationState {
  step:
    | 'start'
    | 'waiting_description'
    | 'waiting_source'
    | 'waiting_category'
    | 'waiting_value'
    | 'waiting_confirmation'
    | 'waiting_ai_confirmation'
    | 'editing_description'
    | 'editing_value'
    | 'editing_source'
    | 'editing_category'
  data: Record<string, string>
  sources?: string[]
  categories?: string[]
  aiExtraction?: ExpenseExtraction
  aiExtractions?: ExpenseExtraction[]
  currentExtractionIndex?: number
}

export interface Expense {
  description: string  // Column D
  source: string       // Column E
  category: string     // Column F
  value: string        // Column G (format "R$ 29,88")
}

export interface InlineKeyboardButton {
  text: string
  callback_data: string
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][]
}

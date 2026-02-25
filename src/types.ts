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

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
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
  data: Record<string, string>
  sources?: string[]
  categories?: string[]
  aiExtraction?: ExpenseExtraction
}

export interface Expense {
  description: string  // Column D
  source: string       // Column E
  category: string     // Column F
  value: string        // Column G (format "R$ 29,88")
}

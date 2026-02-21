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
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

export interface ConversationState {
  step: string
  data: Record<string, string>
  sources?: string[]
  categories?: string[]
}

export interface Expense {
  description: string  // Column D
  source: string       // Column E
  category: string     // Column F
  value: string        // Column G (format "R$ 29,88")
}

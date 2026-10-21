import type { ChatDO } from './chat-do'

export interface Env {
  CHAT: DurableObjectNamespace<ChatDO>
  // Telegram user id of the owner; the only one the bot answers.
  ALLOWED_USER_ID: string
  TELEGRAM_BOT_TOKEN: string
  TELEGRAM_WEBHOOK_SECRET: string
  ANTHROPIC_API_KEY: string
  GOOGLE_CLIENT_EMAIL: string
  GOOGLE_PRIVATE_KEY: string
  GOOGLE_SPREADSHEET_ID: string
  CLAUDE_MODEL?: string
  CLAUDE_EFFORT?: string
  MONTHLY_BUDGET_USD?: string
  COMPACT_AT_TOKENS?: string
  // Development only: fake Telegram API root, and the prefix of the only tabs the
  // agent may see or modify ("TESTE ").
  TELEGRAM_API_ROOT?: string
  SHEETS_SANDBOX_PREFIX?: string
}

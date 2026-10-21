import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type Anthropic from '@anthropic-ai/sdk'
import type { Update } from 'grammy/types'

// Schema of each ChatDO's SQLite database. Migrations are generated from this file
// with `bun run db:generate` and applied when the Durable Object starts.

export const inbox = sqliteTable('inbox', {
  updateId: integer('update_id').primaryKey(),
  payload: text('payload', { mode: 'json' }).$type<Update>().notNull(),
  receivedAt: integer('received_at').notNull(),
  processedAt: integer('processed_at')
})

// A conversation is bound to the system prompt and tool set it started with:
// Sonnet 5.5 thinking blocks are invalidated if either changes mid-conversation.
export const conversations = sqliteTable('conversations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startedAt: integer('started_at').notNull(),
  systemPrompt: text('system_prompt').notNull(),
  toolsHash: text('tools_hash').notNull(),
  // After a compaction, the history sent to the model starts at this message (the
  // signed summary); earlier messages are kept but no longer sent.
  summaryMessageId: integer('summary_message_id')
})

// Append-only: earlier turns are never edited or removed.
export const messages = sqliteTable(
  'messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    conversationId: integer('conversation_id')
      .notNull()
      .references(() => conversations.id),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    content: text('content', { mode: 'json' }).$type<Anthropic.Beta.Messages.BetaMessageParam['content']>().notNull(),
    createdAt: integer('created_at').notNull()
  },
  (table) => [index('messages_by_conversation').on(table.conversationId, table.id)]
)

// Single row (id = 1) describing what the agent is doing in this chat.
export const runState = sqliteTable('run_state', {
  id: integer('id').primaryKey(),
  status: text('status', { enum: ['idle', 'running', 'awaiting_approval'] }).notNull(),
  conversationId: integer('conversation_id').references(() => conversations.id),
  step: integer('step').notNull().default(0),
  pending: text('pending', { mode: 'json' })
})

export const usage = sqliteTable('usage', {
  month: text('month').primaryKey(),
  requests: integer('requests').notNull().default(0),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
  costUsd: real('cost_usd').notNull().default(0),
  alertSent: integer('alert_sent', { mode: 'boolean' }).notNull().default(false)
})

export const settings = sqliteTable('settings', {
  key: text('key', { enum: ['budget_usd', 'model', 'chat_id', 'user_name'] }).primaryKey(),
  value: text('value').notNull()
})

// Log of every write the agent made, with what is needed to revert it.
export const writes = sqliteTable('writes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdAt: integer('created_at').notNull(),
  description: text('description').notNull(),
  undo: text('undo', { mode: 'json' }).$type<unknown[]>().notNull(),
  undoneAt: integer('undone_at')
})

// Long-term user preferences ("Uber é sempre Transporte"). Survive /novo.
export const memories = sqliteTable('memories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  text: text('text').notNull(),
  createdAt: integer('created_at').notNull(),
  deletedAt: integer('deleted_at')
})

// Files the user sent that the agent reads through tools (CSV statements).
export const files = sqliteTable('files', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  rows: text('rows', { mode: 'json' }).$type<string[][]>().notNull(),
  createdAt: integer('created_at').notNull()
})

// Proactive messages fired by cron, run when the chat is idle.
export const jobs = sqliteTable('jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind', { enum: ['weekly_reminder', 'weekly_summary', 'month_close'] }).notNull(),
  createdAt: integer('created_at').notNull(),
  processedAt: integer('processed_at')
})

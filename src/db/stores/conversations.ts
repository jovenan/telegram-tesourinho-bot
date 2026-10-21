import { and, asc, eq, gte } from 'drizzle-orm'
import type { Db } from '..'
import type { MessageParam } from '../../agent/types'
import { conversations, messages } from '../schema'

export type Conversation = typeof conversations.$inferSelect

// Messages are append-only: Sonnet 5.5 thinking blocks are bound to everything
// before them, so earlier turns are never edited or removed. A compaction adds a
// summary message and moves the start of the history to it.
export class ConversationStore {
  constructor(private readonly db: Db) {}

  get(id: number): Conversation | null {
    return this.db.select().from(conversations).where(eq(conversations.id, id)).get() ?? null
  }

  create(systemPrompt: string, toolsHash: string): Conversation {
    return this.db
      .insert(conversations)
      .values({ startedAt: Date.now(), systemPrompt, toolsHash })
      .returning()
      .get()
  }

  // History as sent to the model: from the latest summary on, if there is one.
  messages(conversation: Conversation): MessageParam[] {
    return this.db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversation.id),
          conversation.summaryMessageId ? gte(messages.id, conversation.summaryMessageId) : undefined
        )
      )
      .orderBy(asc(messages.id))
      .all()
  }

  append(conversationId: number, message: MessageParam): number {
    return this.db
      .insert(messages)
      .values({ conversationId, role: message.role, content: message.content, createdAt: Date.now() })
      .returning({ id: messages.id })
      .get().id
  }

  // Replaces everything sent so far with the signed summary returned by the API.
  setSummary(conversationId: number, summary: MessageParam): void {
    const messageId = this.append(conversationId, summary)
    this.db.update(conversations).set({ summaryMessageId: messageId }).where(eq(conversations.id, conversationId)).run()
  }
}

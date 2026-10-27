import { and, asc, desc, eq, gte, inArray, lt, ne } from 'drizzle-orm'
import type { Db } from '..'
import type { MessageParam } from '../../agent/types'
import { conversations, messages } from '../schema'

export type Conversation = typeof conversations.$inferSelect

// Messages are append-only: Sonnet 5.5 thinking blocks are bound to everything
// before them, so earlier turns are never edited. A compaction adds a summary
// message and moves the start of the history to it; only what is no longer sent to
// the model (before the summary, or other conversations) is ever deleted.
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

  // Latest messages across all conversations, newest last (debugging only).
  recent(limit: number) {
    return this.db
      .select({ id: messages.id, conversationId: messages.conversationId, role: messages.role, content: messages.content, createdAt: messages.createdAt })
      .from(messages)
      .orderBy(desc(messages.id))
      .limit(limit)
      .all()
      .reverse()
  }

  append(conversationId: number, message: MessageParam): number {
    return this.db
      .insert(messages)
      .values({ conversationId, role: message.role, content: message.content, createdAt: Date.now() })
      .returning({ id: messages.id })
      .get().id
  }

  // Messages before the summary are no longer sent to the model.
  deleteCompacted(conversation: Conversation): void {
    if (!conversation.summaryMessageId) return
    this.db
      .delete(messages)
      .where(and(eq(messages.conversationId, conversation.id), lt(messages.id, conversation.summaryMessageId)))
      .run()
  }

  // Conversations other than `keepId` started before `before`, with their messages.
  deleteOldConversations(keepId: number | null, before: number): void {
    const old = this.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(lt(conversations.startedAt, before), keepId === null ? undefined : ne(conversations.id, keepId)))
      .all()
      .map((row) => row.id)
    if (old.length === 0) return
    this.db.delete(messages).where(inArray(messages.conversationId, old)).run()
    this.db.delete(conversations).where(inArray(conversations.id, old)).run()
  }

  // Replaces everything sent so far with the signed summary returned by the API.
  setSummary(conversationId: number, summary: MessageParam): void {
    const messageId = this.append(conversationId, summary)
    this.db.update(conversations).set({ summaryMessageId: messageId }).where(eq(conversations.id, conversationId)).run()
  }
}

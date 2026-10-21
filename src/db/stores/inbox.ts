import { asc, eq, isNull } from 'drizzle-orm'
import type { Update } from 'grammy/types'
import type { Db } from '..'
import { inbox } from '../schema'

export interface QueuedUpdate {
  updateId: number
  update: Update
}

export class InboxStore {
  constructor(private readonly db: Db) {}

  // Returns false when the update was already queued (Telegram redelivery).
  add(update: Update): boolean {
    const inserted = this.db
      .insert(inbox)
      .values({ updateId: update.update_id, payload: update, receivedAt: Date.now() })
      .onConflictDoNothing()
      .returning({ updateId: inbox.updateId })
      .all()
    return inserted.length > 0
  }

  pending(): QueuedUpdate[] {
    return this.db
      .select({ updateId: inbox.updateId, update: inbox.payload })
      .from(inbox)
      .where(isNull(inbox.processedAt))
      .orderBy(asc(inbox.updateId))
      .all()
  }

  next(): QueuedUpdate | null {
    return this.pending()[0] ?? null
  }

  markProcessed(updateId: number): void {
    this.db.update(inbox).set({ processedAt: Date.now() }).where(eq(inbox.updateId, updateId)).run()
  }
}

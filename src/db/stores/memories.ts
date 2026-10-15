import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Db } from '..'
import { memories } from '../schema'

export interface Memory {
  id: number
  text: string
}

export class MemoryStore {
  constructor(private readonly db: Db) {}

  list(): Memory[] {
    return this.db
      .select({ id: memories.id, text: memories.text })
      .from(memories)
      .where(isNull(memories.deletedAt))
      .orderBy(asc(memories.id))
      .all()
  }

  add(text: string): Memory {
    return this.db
      .insert(memories)
      .values({ text, createdAt: Date.now() })
      .returning({ id: memories.id, text: memories.text })
      .get()
  }

  remove(id: number): boolean {
    const removed = this.db
      .update(memories)
      .set({ deletedAt: Date.now() })
      .where(and(eq(memories.id, id), isNull(memories.deletedAt)))
      .returning({ id: memories.id })
      .all()
    return removed.length > 0
  }
}

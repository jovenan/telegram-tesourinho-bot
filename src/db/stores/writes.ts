import { desc, eq, isNull } from 'drizzle-orm'
import type { Db } from '..'
import type { UndoOp } from '../../sheets/undo'
import { writes } from '../schema'

export interface WriteLogEntry {
  id: number
  createdAt: number
  description: string
  undo: UndoOp[]
}

export class WriteStore {
  constructor(private readonly db: Db) {}

  add(description: string, undo: UndoOp[]): number {
    return this.db
      .insert(writes)
      .values({ createdAt: Date.now(), description, undo })
      .returning({ id: writes.id })
      .get().id
  }

  lastActive(): WriteLogEntry | null {
    const row = this.db.select().from(writes).where(isNull(writes.undoneAt)).orderBy(desc(writes.id)).limit(1).get()
    return row ? { id: row.id, createdAt: row.createdAt, description: row.description, undo: row.undo as UndoOp[] } : null
  }

  markUndone(id: number): void {
    this.db.update(writes).set({ undoneAt: Date.now() }).where(eq(writes.id, id)).run()
  }
}

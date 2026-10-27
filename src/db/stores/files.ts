import { eq, lt } from 'drizzle-orm'
import type { Db } from '..'
import { files } from '../schema'

export type StoredFile = typeof files.$inferSelect

export class FileStore {
  constructor(private readonly db: Db) {}

  add(id: string, name: string, rows: string[][]): void {
    this.db.insert(files).values({ id, name, rows, createdAt: Date.now() }).onConflictDoNothing().run()
  }

  get(id: string): StoredFile | null {
    return this.db.select().from(files).where(eq(files.id, id)).get() ?? null
  }

  deleteBefore(before: number): void {
    this.db.delete(files).where(lt(files.createdAt, before)).run()
  }
}

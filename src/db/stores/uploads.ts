import { and, inArray, isNull, lt } from 'drizzle-orm'
import type { Db } from '..'
import { uploads } from '../schema'

export class UploadStore {
  constructor(private readonly db: Db) {}

  add(fileId: string): void {
    this.db.insert(uploads).values({ fileId, createdAt: Date.now() }).onConflictDoNothing().run()
  }

  // Files still stored at Anthropic and uploaded before `before`.
  liveBefore(before: number): string[] {
    return this.db
      .select({ fileId: uploads.fileId })
      .from(uploads)
      .where(and(isNull(uploads.deletedAt), lt(uploads.createdAt, before)))
      .all()
      .map((row) => row.fileId)
  }

  markDeleted(fileIds: string[]): void {
    if (fileIds.length === 0) return
    this.db.update(uploads).set({ deletedAt: Date.now() }).where(inArray(uploads.fileId, fileIds)).run()
  }
}

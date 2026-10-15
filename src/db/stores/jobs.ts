import { asc, eq, isNull } from 'drizzle-orm'
import type { Db } from '..'
import { jobs } from '../schema'

export type JobKind = (typeof jobs.$inferSelect)['kind']

export class JobStore {
  constructor(private readonly db: Db) {}

  add(kind: JobKind): void {
    this.db.insert(jobs).values({ kind, createdAt: Date.now() }).run()
  }

  next(): { id: number; kind: JobKind } | null {
    return (
      this.db
        .select({ id: jobs.id, kind: jobs.kind })
        .from(jobs)
        .where(isNull(jobs.processedAt))
        .orderBy(asc(jobs.id))
        .limit(1)
        .get() ?? null
    )
  }

  markProcessed(id: number): void {
    this.db.update(jobs).set({ processedAt: Date.now() }).where(eq(jobs.id, id)).run()
  }
}

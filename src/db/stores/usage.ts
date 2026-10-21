import { eq, sql } from 'drizzle-orm'
import type { Db } from '..'
import { usage } from '../schema'

export type MonthUsage = typeof usage.$inferSelect

export interface UsageDelta {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
}

export class UsageStore {
  constructor(private readonly db: Db) {}

  get(month: string): MonthUsage {
    return (
      this.db.select().from(usage).where(eq(usage.month, month)).get() ?? {
        month,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        alertSent: false
      }
    )
  }

  add(month: string, delta: UsageDelta): MonthUsage {
    return this.db
      .insert(usage)
      .values({ month, requests: 1, ...delta })
      .onConflictDoUpdate({
        target: usage.month,
        set: {
          requests: sql`${usage.requests} + 1`,
          inputTokens: sql`${usage.inputTokens} + ${delta.inputTokens}`,
          outputTokens: sql`${usage.outputTokens} + ${delta.outputTokens}`,
          cacheReadTokens: sql`${usage.cacheReadTokens} + ${delta.cacheReadTokens}`,
          cacheWriteTokens: sql`${usage.cacheWriteTokens} + ${delta.cacheWriteTokens}`,
          costUsd: sql`${usage.costUsd} + ${delta.costUsd}`
        }
      })
      .returning()
      .get()
  }

  markAlertSent(month: string): void {
    this.db.update(usage).set({ alertSent: true }).where(eq(usage.month, month)).run()
  }
}

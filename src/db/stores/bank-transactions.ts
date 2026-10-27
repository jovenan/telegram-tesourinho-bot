import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '..'
import { describe, type BatchItem, type PendingTx, type ResolvedTx } from '../../bank/process'
import type { BankTransaction } from '../../bank/source'
import { bankTransactions } from '../schema'

export type BankTxState = (typeof bankTransactions.$inferSelect)['state']
type Row = typeof bankTransactions.$inferSelect

// A transaction in the open batch, with its position.
export interface ReviewItem extends BatchItem {
  order: number
}

const toPending = (row: Row): PendingTx => ({
  id: row.id,
  accountId: row.accountId,
  date: row.date,
  description: row.description,
  amount: row.amount,
  billDueDate: row.billDueDate,
  installmentNumber: row.installmentNumber,
  totalInstallments: row.totalInstallments,
  mcc: row.mcc,
  providerCategory: row.providerCategory
})

const toReviewItem = (row: Row): ReviewItem => ({
  id: row.id,
  order: row.batchOrder ?? 0,
  tab: row.tab ?? '',
  source: row.source ?? '',
  date: row.date.split('-').reverse().join('/'),
  description: describe(row),
  value: row.amount,
  merchantKey: row.merchantKey ?? '',
  suggestion: row.suggestion,
  suggestionKind: row.suggestionKind,
  duplicate: row.duplicate ?? null,
  closingDay: row.closingDay
})

export class BankTransactionStore {
  constructor(private readonly db: Db) {}

  // Inserts transactions never seen before; returns how many were new.
  addNew(transactions: BankTransaction[]): number {
    let added = 0
    const now = Date.now()
    for (const tx of transactions) {
      const inserted = this.db
        .insert(bankTransactions)
        .values({
          id: tx.id,
          accountId: tx.accountId,
          date: tx.date,
          description: tx.description,
          amount: tx.amount,
          billDueDate: tx.billDueDate ?? null,
          installmentNumber: tx.installment?.number ?? null,
          totalInstallments: tx.installment?.total ?? null,
          mcc: tx.mcc ?? null,
          providerCategory: tx.providerCategory ?? null,
          state: 'new',
          createdAt: now,
          updatedAt: now
        })
        .onConflictDoNothing()
        .returning({ id: bankTransactions.id })
        .all()
      added += inserted.length
    }
    return added
  }

  byState(states: BankTxState[]): PendingTx[] {
    return this.db.select().from(bankTransactions).where(inArray(bankTransactions.state, states)).all().map(toPending)
  }

  // Tabs some transactions are waiting for, with how many.
  waitingTabs(): Array<{ tab: string; count: number }> {
    return this.db
      .select({ tab: bankTransactions.tab, count: sql<number>`count(*)` })
      .from(bankTransactions)
      .where(eq(bankTransactions.state, 'waiting_tab'))
      .groupBy(bankTransactions.tab)
      .all()
      .flatMap((row) => (row.tab ? [{ tab: row.tab, count: row.count }] : []))
  }

  resolved(): ResolvedTx[] {
    return this.db
      .select()
      .from(bankTransactions)
      .where(inArray(bankTransactions.state, ['in_sheet', 'imported']))
      .all()
      .flatMap((row) =>
        row.tab && row.source
          ? [{ tab: row.tab, source: row.source, amount: row.amount, merchantKey: row.merchantKey ?? '', category: row.category, state: row.state as ResolvedTx['state'], updatedAt: row.updatedAt }]
          : []
      )
  }

  counts(): Partial<Record<BankTxState, number>> {
    const rows = this.db
      .select({ state: bankTransactions.state, count: sql<number>`count(*)` })
      .from(bankTransactions)
      .groupBy(bankTransactions.state)
      .all()
    return Object.fromEntries(rows.map((row) => [row.state, row.count]))
  }

  markWaiting(tab: string, ids: string[]): void {
    this.update(ids, { state: 'waiting_tab', tab })
  }

  markInSheet(entries: Array<{ id: string; tab: string; source: string; merchantKey: string; category: string | null }>): void {
    for (const entry of entries) {
      this.update([entry.id], { state: 'in_sheet', tab: entry.tab, source: entry.source, merchantKey: entry.merchantKey, category: entry.category })
    }
  }

  // Puts the batch items up for review, in order.
  startReview(items: BatchItem[]): void {
    items.forEach((item, order) =>
      this.update([item.id], {
        state: 'review',
        tab: item.tab,
        source: item.source,
        merchantKey: item.merchantKey,
        suggestion: item.suggestion,
        suggestionKind: item.suggestionKind,
        duplicate: item.duplicate,
        closingDay: item.closingDay,
        batchOrder: order,
        category: null
      })
    )
  }

  reviewItems(): ReviewItem[] {
    return this.db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.state, 'review'))
      .orderBy(asc(bankTransactions.batchOrder))
      .all()
      .map(toReviewItem)
  }

  reviewItem(order: number): ReviewItem | null {
    const row = this.db
      .select()
      .from(bankTransactions)
      .where(and(eq(bankTransactions.state, 'review'), eq(bankTransactions.batchOrder, order)))
      .get()
    return row ? toReviewItem(row) : null
  }

  markImported(entries: Array<{ id: string; category: string }>): void {
    for (const entry of entries) this.update([entry.id], { state: 'imported', category: entry.category, batchOrder: null })
  }

  setState(ids: string[], state: BankTxState): void {
    this.update(ids, { state, batchOrder: null })
  }

  clearDuplicate(id: string): void {
    this.update([id], { duplicate: null })
  }

  // Review items go back to "new" (batch replaced or closed by another one).
  returnReviewToNew(): void {
    this.db.update(bankTransactions).set({ state: 'new', batchOrder: null, updatedAt: Date.now() }).where(eq(bankTransactions.state, 'review')).run()
  }

  private update(ids: string[], values: Partial<typeof bankTransactions.$inferInsert>): void {
    if (ids.length === 0) return
    this.db
      .update(bankTransactions)
      .set({ ...values, updatedAt: Date.now() })
      .where(inArray(bankTransactions.id, ids))
      .run()
  }
}

import { eq } from 'drizzle-orm'
import type { Db } from '..'
import type { PendingApproval } from '../../agent/types'
import { runState } from '../schema'

export type RunStatus = (typeof runState.$inferSelect)['status']

export interface RunState {
  status: RunStatus
  conversationId: number | null
  step: number
  pending: PendingApproval | null
}

const ROW = eq(runState.id, 1)

export class RunStateStore {
  constructor(private readonly db: Db) {}

  get(): RunState {
    const row = this.db.select().from(runState).where(ROW).get()!
    return { ...row, pending: (row.pending as PendingApproval | null) ?? null }
  }

  startConversation(conversationId: number): void {
    this.db.update(runState).set({ status: 'idle', conversationId, step: 0, pending: null }).where(ROW).run()
  }

  startRun(): void {
    this.db.update(runState).set({ status: 'running', step: 0, pending: null }).where(ROW).run()
  }

  nextStep(step: number): void {
    this.db.update(runState).set({ status: 'running', step: step + 1, pending: null }).where(ROW).run()
  }

  awaitApproval(pending: PendingApproval): void {
    this.db.update(runState).set({ status: 'awaiting_approval', pending }).where(ROW).run()
  }

  finishRun(): void {
    this.db.update(runState).set({ status: 'idle', step: 0, pending: null }).where(ROW).run()
  }
}

import type { Expense } from '../sheets/expenses'
import { parseSheetDate, type CalendarDay } from '../utils/dates'
import { normalize } from './text'

const NEAR_DAYS = 3

export interface MatchCandidate {
  tab: string
  source: string
  value: number
  date: CalendarDay
}

export type MatchResult =
  | { kind: 'none' }
  // Certainly the same purchase: one row, same source, value and close date.
  | { kind: 'in_sheet'; row: Expense }
  // Probably the same: the user decides.
  | { kind: 'maybe'; row: Expense }

const sameValue = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 0.005
function daysApart(a: CalendarDay, b: CalendarDay): number {
  return Math.abs(Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)) / 86_400_000
}

// Signature used to count how many rows a group of transactions has already claimed.
// Rows move (insertions, deletions), so claims are counted, not pinned to a row.
export function signature(tab: string, source: string, value: number): string {
  return `${tab}|${normalize(source)}|${Math.round(value * 100)}`
}

// Rows of a tab that look like this purchase: same source and value. The date only
// decides between "certain" and "ask".
export function matchExpense(candidate: MatchCandidate, rows: Expense[], claimed: number): MatchResult {
  const same = rows.filter((row) => normalize(row.source) === normalize(candidate.source) && sameValue(row.value, candidate.value))
  // Every such row already belongs to another transaction.
  if (same.length - claimed <= 0) return { kind: 'none' }

  const distance = (row: Expense) => {
    const day = parseSheetDate(row.date)
    return day ? daysApart(day, candidate.date) : 0
  }
  const near = same.filter((row) => distance(row) <= NEAR_DAYS)
  const closest = [...same].sort((a, b) => distance(a) - distance(b))[0]

  if (same.length === 1 && claimed === 0 && near.length === 1) return { kind: 'in_sheet', row: near[0] }
  return { kind: 'maybe', row: near[0] ?? closest }
}

// Keeps per-signature claims while a batch is matched, so two equal purchases don't
// both match the same row.
export class ClaimCounter {
  private readonly counts = new Map<string, number>()

  constructor(initial: string[] = []) {
    for (const sig of initial) this.add(sig)
  }

  get(sig: string): number {
    return this.counts.get(sig) ?? 0
  }

  add(sig: string): void {
    this.counts.set(sig, this.get(sig) + 1)
  }
}

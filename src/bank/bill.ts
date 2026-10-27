import { addDays, dayKey, monthLabelOf, type CalendarDay } from '../utils/dates'
import type { CardConfig } from './config'

type Card = Pick<CardConfig, 'dueDay' | 'closingDaysBeforeDue'>

export interface Bill {
  due: CalendarDay
  closing: CalendarDay
}

// Due date of the card's bill in a given month (clamped to the month's length).
function dueIn(year: number, month: number, card: Card): CalendarDay {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { year, month, day: Math.min(card.dueDay, lastDay) }
}

function nextMonth({ year, month }: { year: number; month: number }) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
}

// The bill a purchase falls on: the first one whose closing date is on or after the
// purchase. Closing = due date − closingDaysBeforeDue (calendar days).
export function billFor(purchase: CalendarDay, card: Card): Bill {
  let candidate = { year: purchase.year, month: purchase.month }
  for (;;) {
    const due = dueIn(candidate.year, candidate.month, card)
    const closing = addDays(due, -card.closingDaysBeforeDue)
    if (dayKey(purchase) <= dayKey(closing)) return { due, closing }
    candidate = nextMonth(candidate)
  }
}

// First day the next bill accepts purchases ("melhor dia de compra").
export function bestPurchaseDay(bill: Bill): CalendarDay {
  return addDays(bill.closing, 1)
}

export interface TargetMonth {
  // "MM/YYYY" of the tab the purchase goes to.
  month: string
  // On the closing day the purchase may land on either bill: the other month to
  // look in when matching, and a ⚠️ in the preview.
  alternative?: string
  fromBank: boolean
}

// Tab month for a card purchase: the bank's bill when it says, else the rule.
export function targetMonth(purchase: CalendarDay, card: Card, billDueDate?: CalendarDay | null): TargetMonth {
  if (billDueDate) return { month: monthLabelOf(billDueDate), fromBank: true }

  const bill = billFor(purchase, card)
  const month = monthLabelOf(bill.due)
  if (dayKey(purchase) !== dayKey(bill.closing)) return { month, fromBank: false }
  return { month, alternative: monthLabelOf(billFor(addDays(purchase, 1), card).due), fromBank: false }
}

// "2026-10-15" → CalendarDay.
export function parseIsoDay(text: string): CalendarDay | null {
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null
}

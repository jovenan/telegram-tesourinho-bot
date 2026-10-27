import { expect, test } from 'bun:test'
import { cardForSource, parseCards } from '../src/bank/config'
import { importable } from '../src/bank/filter'
import type { BankTransaction } from '../src/bank/source'

const cards = parseCards(JSON.stringify({ 'acc-c6': { source: 'C6', dueDay: 5, closingDaysBeforeDue: 7 } }))
const tx = (extra: Partial<BankTransaction>): BankTransaction => ({
  id: 't1',
  accountId: 'acc-c6',
  date: '2026-10-15',
  description: 'UBER *TRIP',
  amount: 23.1,
  status: 'posted',
  kind: 'purchase',
  ...extra
})

test('only confirmed purchases on configured cards are imported', () => {
  expect(importable(tx({}), cards)).toBe(true)
  expect(importable(tx({ status: 'pending' }), cards)).toBe(false)
  expect(importable(tx({ kind: 'bill_payment' }), cards)).toBe(false)
  expect(importable(tx({ kind: 'refund' }), cards)).toBe(false)
  expect(importable(tx({ accountId: 'other' }), cards)).toBe(false)
})

test('card settings are validated', () => {
  expect(cards).toEqual([{ accountId: 'acc-c6', source: 'C6', dueDay: 5, closingDaysBeforeDue: 7 }])
  expect(parseCards('{"a": {"source": "C6", "dueDay": 40, "closingDaysBeforeDue": 7}}')).toEqual([])
  expect(parseCards('not json')).toEqual([])
  expect(parseCards(undefined)).toEqual([])
})

test('sources map back to their card ignoring case and accents', () => {
  expect(cardForSource(cards, 'c6')?.accountId).toBe('acc-c6')
  expect(cardForSource(cards, 'Nubank')).toBeNull()
})

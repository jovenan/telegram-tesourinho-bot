import { expect, test } from 'bun:test'
import { ClaimCounter, matchExpense, signature } from '../src/bank/match'
import type { Expense } from '../src/sheets/expenses'

const row = (extra: Partial<Expense>): Expense => ({ row: 10, date: '15/10/2026', description: 'Uber', source: 'C6', category: 'Transporte', value: 23.1, ...extra })
const purchase = { tab: 'Gastos 11/2026', source: 'C6', value: 23.1, date: { year: 2026, month: 10, day: 16 } }

test('one row with the same source, value and a close date is the same purchase', () => {
  expect(matchExpense(purchase, [row({})], 0)).toMatchObject({ kind: 'in_sheet', row: { row: 10 } })
  // Rows typed without a date still count as close.
  expect(matchExpense(purchase, [row({ date: '' })], 0)).toMatchObject({ kind: 'in_sheet' })
})

test('a far date or several candidates asks the user', () => {
  expect(matchExpense(purchase, [row({ date: '01/10/2026' })], 0)).toMatchObject({ kind: 'maybe', row: { row: 10 } })
  expect(matchExpense(purchase, [row({ row: 10 }), row({ row: 11, date: '20/10/2026' })], 0)).toMatchObject({ kind: 'maybe', row: { row: 10 } })
})

test('different source or value is not a match', () => {
  expect(matchExpense(purchase, [row({ source: 'Nubank' })], 0)).toEqual({ kind: 'none' })
  expect(matchExpense(purchase, [row({ value: 23.11 })], 0)).toEqual({ kind: 'none' })
})

test('two equal purchases on the same day need two rows', () => {
  const claims = new ClaimCounter()
  const sig = signature(purchase.tab, 'C6', 23.1)

  // The first purchase takes the only row...
  const first = matchExpense(purchase, [row({})], claims.get(sig))
  expect(first.kind).toBe('in_sheet')
  claims.add(sig)

  // ...so the second one is new.
  expect(matchExpense(purchase, [row({})], claims.get(sig))).toEqual({ kind: 'none' })
})

test('signatures ignore case and accents in the source and round to cents', () => {
  expect(signature('Gastos 11/2026', 'Crédito C6', 23.1)).toBe(signature('Gastos 11/2026', 'credito c6', 23.100001))
})

import { describe, expect, test } from 'bun:test'
import { lastUsedRow, planExpenseRows, sheetNumber } from '../src/sheets/expenses'
import { addMonths, canonicalOption, looksDuplicate, parseDate } from '../src/tools/sheets/shared'
import { columnIndex, parseCell, rangeFrom } from '../src/sheets/a1'
import { approvalKeyboard, parseApproval } from '../src/telegram/keyboards'

describe('planExpenseRows', () => {
  test('writes right after the last used row when there is room', () => {
    expect(planExpenseRows(30, 125, 2)).toEqual({ startRow: 31, insertRows: 0 })
  })

  test('keeps the last row free and grows the table inside the formula range', () => {
    // rows 31..124 are free (94) and 125 stays as the anchor
    expect(planExpenseRows(30, 125, 94)).toEqual({ startRow: 31, insertRows: 0 })
    expect(planExpenseRows(30, 125, 95).insertRows).toBeGreaterThan(0)
  })

  test('full table (last row used) inserts before the last row', () => {
    expect(planExpenseRows(127, 127, 1)).toEqual({ startRow: 127, insertRows: 21 })
  })
})

test('lastUsedRow ignores trailing blanks', () => {
  expect(lastUsedRow([['a'], [''], ['b'], [], ['']])).toBe(4)
  expect(lastUsedRow([])).toBe(1)
})

test('sheetNumber uses a comma', () => {
  expect(sheetNumber(45.9)).toBe('45,90')
})

describe('dates and installments', () => {
  test('parseDate validates real dates', () => {
    expect(parseDate('15/10/2026')).toEqual({ day: 15, month: 10, year: 2026 })
    expect(() => parseDate('31/02/2026')).toThrow()
    expect(() => parseDate('2026-10-15')).toThrow()
  })

  test('addMonths rolls the year and clamps the day', () => {
    expect(addMonths({ day: 31, month: 12, year: 2026 }, 1)).toEqual({ day: 31, month: 1, year: 2027 })
    expect(addMonths({ day: 31, month: 1, year: 2027 }, 1)).toEqual({ day: 28, month: 2, year: 2027 })
  })
})

test('canonicalOption matches ignoring case and accents', () => {
  expect(canonicalOption('saude', ['Saúde', 'Lazer'], 'Categoria')).toBe('Saúde')
  expect(() => canonicalOption('Viagens', ['Viagem'], 'Categoria')).toThrow(/Viagem/)
})

test('looksDuplicate needs same value and first word', () => {
  expect(looksDuplicate({ description: 'IFOOD *IFOOD - AI GENERATED', value: 45 }, { description: 'iFood', value: 45 })).toBe(true)
  expect(looksDuplicate({ description: 'IFOOD', value: 45 }, { description: 'IFOOD', value: 46 })).toBe(false)
  expect(looksDuplicate({ description: 'UBER *TRIP', value: 45 }, { description: 'IFOOD', value: 45 })).toBe(false)
})

test('A1 helpers', () => {
  expect(columnIndex('G')).toBe(6)
  expect(parseCell('F12')).toEqual({ column: 5, row: 12 })
  expect(parseCell('F')).toBeNull()
  expect(rangeFrom({ column: 2, row: 5 }, 2, 5)).toBe('C5:G6')
})

test('approval callback data round-trips', () => {
  const data = approvalKeyboard('abc123').inline_keyboard[0].map((button) => (button as { callback_data: string }).callback_data)
  expect(data.map(parseApproval)).toEqual([
    { approved: true, token: 'abc123' },
    { approved: false, token: 'abc123' }
  ])
  expect(parseApproval('budget:raise')).toBeNull()
})

test('card import callback data round-trips and fits in 64 bytes', async () => {
  const { bankPreviewKeyboard, bankReviewKeyboard, parseBankCallback } = await import('../src/telegram/keyboards')
  const categories = Array.from({ length: 20 }, (_, i) => `Categoria ${i}`)
  const keyboards = [
    bankPreviewKeyboard('abcdefghij', 3, 5),
    bankReviewKeyboard('abcdefghij', { order: 12, suggestion: 'Lazer', duplicate: null }, categories, 2),
    bankReviewKeyboard('abcdefghij', { order: 3, suggestion: null, duplicate: { row: 4 } }, categories, 0)
  ]
  const data = keyboards.flatMap((k) => k.inline_keyboard.flat().map((button) => (button as { callback_data: string }).callback_data))
  expect(data.every((d) => new TextEncoder().encode(d).length <= 64)).toBe(true)
  expect(data.every((d) => parseBankCallback(d) !== null)).toBe(true)
  expect(parseBankCallback('bank:cat:abcdefghij:12:17')).toEqual({ action: 'cat', token: 'abcdefghij', args: [12, 17] })
  expect(parseBankCallback('bank:sync:')).toEqual({ action: 'sync', token: '', args: [] })
  expect(parseBankCallback('bank:nope:x')).toBeNull()
  expect(parseBankCallback('approve:abc')).toBeNull()
})

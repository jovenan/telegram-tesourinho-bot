import { expect, test } from 'bun:test'
import { columnLetter, parseSheetTitle, quoteSheetTitle, sheetRange } from '../src/sheets/a1'

test('quotes titles and escapes single quotes', () => {
  expect(quoteSheetTitle('Gastos 10/2026')).toBe("'Gastos 10/2026'")
  expect(quoteSheetTitle("Fatura d'Ana")).toBe("'Fatura d''Ana'")
  expect(sheetRange('Gastos 10/2026', 'C2:G10')).toBe("'Gastos 10/2026'!C2:G10")
})

test('parseSheetTitle reverses sheetRange', () => {
  expect(parseSheetTitle("'Gastos 10/2026'!C2:G10")).toBe('Gastos 10/2026')
  expect(parseSheetTitle("'Fatura d''Ana'!A1")).toBe("Fatura d'Ana")
  expect(parseSheetTitle('Plan1!A1')).toBe('Plan1')
})

test('columnLetter', () => {
  expect([0, 6, 25, 26, 27, 701].map(columnLetter)).toEqual(['A', 'G', 'Z', 'AA', 'AB', 'ZZ'])
})

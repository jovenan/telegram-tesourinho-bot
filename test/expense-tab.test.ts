import { expect, test } from 'bun:test'
import { NotExpenseTabError, Spreadsheet } from '../src/sheets/expenses'
import { assertCleanValues } from '../src/tools/sheets/shared'
import type { SheetsClient } from '../src/sheets/client'

const HEADERS: Record<string, string[]> = {
  'Gastos 10/2026': ['Data', 'Gasto', 'Fonte de saida', 'Categoria', 'Valor'],
  'Cópia de Gastos 11/2026': ['data', 'Gasto', 'Fonte de saída', 'Categoria', 'Valor'],
  Viagem: ['Item', 'Valor', 'Status']
}

const client = {
  listSheets: async () => Object.keys(HEADERS).map((title, i) => ({ sheetId: i, title, index: i, hidden: false, rowCount: 10, columnCount: 11 })),
  getValues: async (range: string) => [HEADERS[range.slice(1, range.lastIndexOf("'"))]],
  range: (title: string, cells: string) => `'${title}'!${cells}`
} as unknown as SheetsClient

test('expense tabs are recognized by their headers, not their names', async () => {
  const spreadsheet = new Spreadsheet(client)
  expect(await spreadsheet.isExpenseTab('Gastos 10/2026')).toBe(true)
  expect(await spreadsheet.isExpenseTab('Cópia de Gastos 11/2026')).toBe(true)
  expect(await spreadsheet.isExpenseTab('Viagem')).toBe(false)
  await expect(spreadsheet.expenseTab('Viagem')).rejects.toBeInstanceOf(NotExpenseTabError)
})

test('values with line breaks are refused', () => {
  expect(() => assertCleanValues([['Saúde', 'ok']])).not.toThrow()
  expect(() => assertCleanValues([['Sa\ní']])).toThrow()
})

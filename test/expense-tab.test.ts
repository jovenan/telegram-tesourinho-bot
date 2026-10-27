import { expect, test } from 'bun:test'
import { monthTabPattern, NotExpenseTabError, SheetNotFoundError, Spreadsheet, TabNotAllowedError } from '../src/sheets/expenses'
import { assertCleanValues } from '../src/tools/sheets/shared'
import type { SheetsClient } from '../src/sheets/client'

const GOOD = ['Data', 'Gasto', 'Fonte de saida', 'Categoria', 'Valor']
const TABS: Record<string, { headers: string[]; hidden?: boolean }> = {
  'Gastos 10/2026': { headers: GOOD },
  'Gastos 11/2026': { headers: ['Item', 'Valor', 'Status'] },
  'Gastos 09/2026': { headers: GOOD, hidden: true },
  'Cópia de Gastos 11/2026': { headers: GOOD },
  Viagem: { headers: ['Item', 'Valor', 'Status'] }
}

const client = {
  listSheets: async () =>
    Object.entries(TABS).map(([title, tab], i) => ({ sheetId: i, title, index: i, hidden: tab.hidden ?? false, rowCount: 10, columnCount: 11 })),
  getValues: async (range: string) => [TABS[range.slice(1, range.lastIndexOf("'"))].headers],
  range: (title: string, cells: string) => `'${title}'!${cells}`
} as unknown as SheetsClient

test('only visible "Gastos MM/AAAA" tabs are accessible', async () => {
  const spreadsheet = new Spreadsheet(client)
  expect((await spreadsheet.tabs()).map((tab) => tab.title)).toEqual(['Gastos 10/2026', 'Gastos 11/2026'])

  expect(await spreadsheet.hasTab('Gastos 10/2026')).toBe(true)
  expect(await spreadsheet.hasTab('Gastos 09/2026')).toBe(false)
  expect(await spreadsheet.hasTab('Cópia de Gastos 11/2026')).toBe(false)

  await expect(spreadsheet.tab('Gastos 09/2026')).rejects.toBeInstanceOf(TabNotAllowedError)
  await expect(spreadsheet.tab('Cópia de Gastos 11/2026')).rejects.toBeInstanceOf(TabNotAllowedError)
  await expect(spreadsheet.tab('Viagem')).rejects.toBeInstanceOf(TabNotAllowedError)
  await expect(spreadsheet.tab('Gastos 12/2026')).rejects.toBeInstanceOf(SheetNotFoundError)
})

test('a month tab with a broken header is not an expense tab', async () => {
  const spreadsheet = new Spreadsheet(client)
  expect(await spreadsheet.isExpenseTab('Gastos 10/2026')).toBe(true)
  await expect(spreadsheet.expenseTab('Gastos 11/2026')).rejects.toBeInstanceOf(NotExpenseTabError)
})

test('month tab pattern honors the sandbox prefix', () => {
  expect(monthTabPattern().test('Gastos 10/2026')).toBe(true)
  expect(monthTabPattern().test('Gastos 13/2026')).toBe(false)
  expect(monthTabPattern().test('TESTE Gastos 10/2026')).toBe(false)
  expect(monthTabPattern('TESTE ').test('TESTE Gastos 10/2026')).toBe(true)
  expect(monthTabPattern('TESTE ').test('Gastos 10/2026')).toBe(false)
})

test('values with line breaks are refused', () => {
  expect(() => assertCleanValues([['Saúde', 'ok']])).not.toThrow()
  expect(() => assertCleanValues([['Sa\ní']])).toThrow()
})

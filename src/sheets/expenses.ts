import type { CellValue, SheetInfo, SheetsClient } from './client'
import { blank, type UndoOp } from './undo'

// Layout of a monthly "Gastos MM/YYYY" tab:
//   A–B  panel: "Renda" (rows 2–5, total in 6), "Gastos" (totals per source),
//        "Saldos" (balances) — the last two are formulas over the expense table.
//   C–G  expense table: Data | Gasto | Fonte de saida | Categoria | Valor
export const EXPENSE_FIRST_ROW = 2
export const EXPENSE_COLUMNS = 5 // C..G
export const PANEL_RANGE = 'A1:B30'
export const INCOME_ROWS = { first: 2, last: 5 }
// Spare rows added whenever the expense table runs out of space.
const GROWTH_ROWS = 20

export interface Expense {
  row: number
  date: string
  description: string
  source: string
  category: string
  value: number | null
}

export interface PanelEntry {
  label: string
  value: string
}

export interface MonthPanel {
  sections: Array<{ title: string; entries: PanelEntry[] }>
}

export interface ExpenseOptions {
  sources: string[]
  categories: string[]
}

export class SheetNotFoundError extends Error {
  constructor(title: string) {
    super(`A aba "${title}" não existe na planilha.`)
    this.name = 'SheetNotFoundError'
  }
}

// "R$ 1.234,56", "1234,56", "-12,3", 1234.56 → number. Returns null when not numeric.
export function parseBrl(value: CellValue | undefined): number | null {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return null

  const cleaned = value.replace(/[R$\s]/g, '')
  if (!/^-?[\d.,]+$/.test(cleaned)) return null

  const normalized = cleaned.replace(/\./g, '').replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

// Value as typed into the sheet (pt-BR locale): 45.9 → "45,90".
export function sheetNumber(value: number): string {
  return value.toFixed(2).replace('.', ',')
}

export function formatBrl(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ')
}

// Accepts "10/2026", "2026-10" or "10-2026" and returns the canonical "10/2026".
export function normalizeMonth(input: string): string | null {
  const trimmed = input.trim()
  const monthFirst = trimmed.match(/^(\d{1,2})[/-](\d{4})$/)
  const yearFirst = trimmed.match(/^(\d{4})[/-](\d{1,2})$/)
  const [month, year] = monthFirst ? [monthFirst[1], monthFirst[2]] : yearFirst ? [yearFirst[2], yearFirst[1]] : []

  if (!month || !year || Number(month) < 1 || Number(month) > 12) return null
  return `${month.padStart(2, '0')}/${year}`
}

// Values of C2:G{n} → expenses, skipping rows without a description.
export function parseExpenseRows(values: CellValue[][], firstRow = EXPENSE_FIRST_ROW): Expense[] {
  const expenses: Expense[] = []

  values.forEach((cells, i) => {
    const [date, description, source, category, value] = cells.map((cell) => String(cell ?? '').trim())
    if (!description) return

    expenses.push({
      row: firstRow + i,
      date: date ?? '',
      description,
      source: source ?? '',
      category: category ?? '',
      value: parseBrl(value)
    })
  })

  return expenses
}

// Values of A1:B30 → sections. A row whose B cell is "Valor" starts a new section.
export function parsePanel(values: CellValue[][]): MonthPanel {
  const sections: MonthPanel['sections'] = []

  for (const [label, value] of values.map((cells) => cells.map((cell) => String(cell ?? '').trim()))) {
    if (!label) continue

    if (value === 'Valor') {
      sections.push({ title: label, entries: [] })
    } else if (sections.length > 0) {
      sections[sections.length - 1].entries.push({ label, value: value ?? '' })
    }
  }

  return { sections }
}

function listValues(rule: unknown): string[] {
  const condition = (rule as { condition?: { type?: string; values?: Array<{ userEnteredValue?: string }> } })?.condition
  if (condition?.type !== 'ONE_OF_LIST') return []
  return (condition.values ?? []).map((v) => v.userEnteredValue ?? '').filter(Boolean)
}

export interface SpreadsheetOptions {
  // When set (development), only tabs whose title starts with this prefix are visible,
  // readable or writable, and monthly tabs are "<prefix>Gastos MM/YYYY".
  sandboxPrefix?: string
}

// Where new expenses go, given the last used row of the table and the tab size.
// The panel formulas cover the table down to the tab's last row, so when space runs
// out rows are inserted *before* that last row: Sheets then grows the formula ranges.
// One blank row is kept at the end so future insertions stay inside the ranges.
export function planExpenseRows(lastUsedRow: number, rowCount: number, needed: number): { startRow: number; insertRows: number } {
  if (lastUsedRow >= rowCount) {
    return { startRow: rowCount, insertRows: needed + GROWTH_ROWS }
  }

  const free = rowCount - 1 - lastUsedRow
  if (free >= needed) return { startRow: lastUsedRow + 1, insertRows: 0 }
  return { startRow: lastUsedRow + 1, insertRows: needed - free + GROWTH_ROWS }
}

export function lastUsedRow(descriptions: CellValue[][], firstRow = EXPENSE_FIRST_ROW): number {
  for (let i = descriptions.length - 1; i >= 0; i--) {
    if (String(descriptions[i]?.[0] ?? '').trim()) return firstRow + i
  }
  return firstRow - 1
}

export class Spreadsheet {
  readonly prefix: string

  constructor(
    readonly client: SheetsClient,
    options: SpreadsheetOptions = {}
  ) {
    this.prefix = options.sandboxPrefix ?? ''
  }

  monthTabTitle(month: string): string {
    return `${this.prefix}Gastos ${month}`
  }

  isMonthTab(title: string): boolean {
    return title.startsWith(`${this.prefix}Gastos `) && normalizeMonth(title.slice(`${this.prefix}Gastos `.length)) !== null
  }

  async hasTab(title: string): Promise<boolean> {
    return (await this.tabs(true)).some((sheet) => sheet.title === title)
  }

  async tabs(includeHidden = false): Promise<SheetInfo[]> {
    const sheets = await this.client.listSheets()
    return sheets.filter((sheet) => sheet.title.startsWith(this.prefix) && (includeHidden || !sheet.hidden))
  }

  async tab(title: string): Promise<SheetInfo> {
    const found = (await this.tabs(true)).find((sheet) => sheet.title === title)
    if (!found) throw new SheetNotFoundError(title)
    return found
  }

  async readRange(title: string, cells: string): Promise<CellValue[][]> {
    await this.tab(title)
    return this.client.getValues(this.client.range(title, cells))
  }

  async expenses(month: string): Promise<Expense[]> {
    const tab = await this.tab(this.monthTabTitle(month))
    const values = await this.client.getValues(this.client.range(tab.title, `C${EXPENSE_FIRST_ROW}:G${tab.rowCount}`))
    return parseExpenseRows(values)
  }

  async panel(month: string): Promise<MonthPanel> {
    const tab = await this.tab(this.monthTabTitle(month))
    return parsePanel(await this.client.getValues(this.client.range(tab.title, PANEL_RANGE)))
  }

  // Dropdown options of the "Fonte de saida" (E) and "Categoria" (F) columns.
  async options(month: string): Promise<ExpenseOptions> {
    const tab = await this.tab(this.monthTabTitle(month))
    const rules = await this.client.getDataValidation(this.client.range(tab.title, `E${EXPENSE_FIRST_ROW}:F${EXPENSE_FIRST_ROW}`))
    return {
      sources: listValues(rules.find((r) => r.column === 4)?.rule),
      categories: listValues(rules.find((r) => r.column === 5)?.rule)
    }
  }
}

export interface ExpenseWrite {
  range: string
  undo: UndoOp
}

// Appends rows (C..G values) to a month's expense table, growing the tab if needed.
export async function appendExpenses(spreadsheet: Spreadsheet, month: string, rows: CellValue[][]): Promise<ExpenseWrite> {
  const { client } = spreadsheet
  const tab = await spreadsheet.tab(spreadsheet.monthTabTitle(month))
  const descriptions = await client.getValues(client.range(tab.title, `D${EXPENSE_FIRST_ROW}:D${tab.rowCount}`))
  const plan = planExpenseRows(lastUsedRow(descriptions), tab.rowCount, rows.length)

  if (plan.insertRows > 0) {
    await client.batchUpdate([
      {
        insertDimension: {
          range: { sheetId: tab.sheetId, dimension: 'ROWS', startIndex: tab.rowCount - 1, endIndex: tab.rowCount - 1 + plan.insertRows },
          inheritFromBefore: true
        }
      }
    ])
  }

  const range = client.range(tab.title, `C${plan.startRow}:G${plan.startRow + rows.length - 1}`)
  await client.updateValues(range, rows)
  // The rows were empty before (or inserted blank), so undoing clears them.
  return { range, undo: { type: 'restore', range, values: blank(rows.length, EXPENSE_COLUMNS) } }
}

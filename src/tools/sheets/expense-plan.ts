import { appendExpenses, sheetNumber, type Spreadsheet } from '../../sheets/expenses'
import type { CellValue } from '../../sheets/client'
import type { UndoOp } from '../../sheets/undo'
import { AI_SUFFIX } from './shared'

export interface PlannedExpense {
  date: string
  description: string
  source: string
  category: string
  value: number
  duplicateOf?: string
}

export interface ExpenseGroup {
  tab: string
  expenses: PlannedExpense[]
}

export interface ExpenseWriteResult {
  // "3 em 'Gastos 11/2026'!C40:G42" per tab.
  written: string[]
  undo: UndoOp[]
  description: string
}

// Writes already validated expenses (dropdown options, existing tabs), one append per
// tab. Shared by add_expense and the card import, so both get the same table growth
// and undo log.
export async function writeExpenses(spreadsheet: Spreadsheet, groups: ExpenseGroup[]): Promise<ExpenseWriteResult> {
  const written: string[] = []
  const undo: UndoOp[] = []

  for (const group of groups) {
    const rows: CellValue[][] = group.expenses.map((e) => [e.date, `${e.description}${AI_SUFFIX}`, e.source, e.category, sheetNumber(e.value)])
    const result = await appendExpenses(spreadsheet, group.tab, rows)
    undo.push(result.undo)
    written.push(`${group.expenses.length} em ${result.range}`)
  }

  return { written, undo, description: `lançamento de ${groups.flatMap((g) => g.expenses.map((e) => e.description)).join(', ')}` }
}

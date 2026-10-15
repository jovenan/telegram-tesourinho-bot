import type { Tool } from './registry'
import { readFile } from './files'
import { forget, listMemories, remember } from './memory'
import { addExpense } from './sheets/add-expense'
import { addIncome } from './sheets/add-income'
import { appendRows } from './sheets/append-rows'
import { deleteExpenses } from './sheets/delete-expenses'
import { deleteRows } from './sheets/delete-rows'
import { findRows } from './sheets/find-rows'
import { listExpenses } from './sheets/list-expenses'
import { listOptions } from './sheets/list-options'
import { listSheets } from './sheets/list-sheets'
import { monthSummary } from './sheets/month-summary'
import { readRange } from './sheets/read-range'
import { updateCells } from './sheets/update-cells'
import { undoLastWrite } from './undo-last-write'

// Order matters for prompt caching: keep it stable.
export const TOOLS: Tool[] = [
  monthSummary,
  listExpenses,
  listOptions,
  addExpense,
  updateCells,
  deleteExpenses,
  undoLastWrite,
  addIncome,
  listSheets,
  readRange,
  findRows,
  appendRows,
  deleteRows,
  readFile,
  remember,
  forget,
  listMemories
]

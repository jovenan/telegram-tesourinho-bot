import { z } from 'zod'
import { EXPENSE_COLUMNS } from '../../sheets/expenses'
import { blank, snapshot, type UndoOp } from '../../sheets/undo'
import type { CellValue } from '../../sheets/client'
import { defineWriteTool, ToolError } from '../registry'
import { assertUnchanged, brl, html, MAX_DELETE_ROWS } from './shared'
import { monthField, requireMonth } from './month'

interface Plan {
  rows: Array<{ range: string; before: CellValue[][]; description: string }>
}

export const deleteExpenses = defineWriteTool({
  name: 'delete_expenses',
  description:
    'Apaga lançamentos da tabela de gastos de um mês (limpa C–G das linhas indicadas, sem mexer no painel A–B). Use os números de linha de list_expenses. O usuário aprova antes.',
  kind: 'write',
  input: z.strictObject({
    month: monthField,
    rows: z.array(z.number().int()).describe('Números das linhas a apagar')
  }),

  async prepare({ month, rows }, { spreadsheet }) {
    const monthLabel = requireMonth(month)
    const unique = [...new Set(rows)].sort((a, b) => a - b)
    if (unique.length === 0) throw new ToolError('Nenhuma linha informada.')
    if (unique.length > MAX_DELETE_ROWS) throw new ToolError(`Máximo de ${MAX_DELETE_ROWS} linhas por vez.`)

    const expenses = await spreadsheet.expenses(monthLabel)
    const tab = spreadsheet.monthTabTitle(monthLabel)
    const plan: Plan = { rows: [] }
    const lines = [`🗑️ <b>Apagar ${unique.length} ${unique.length === 1 ? 'lançamento' : 'lançamentos'} de ${html(tab)}</b>`]

    for (const row of unique) {
      const expense = expenses.find((e) => e.row === row)
      if (!expense) throw new ToolError(`A linha ${row} de ${tab} não tem lançamento.`)
      const range = spreadsheet.client.range(tab, `C${row}:G${row}`)
      plan.rows.push({ range, before: await snapshot(spreadsheet.client, range, 1, EXPENSE_COLUMNS), description: expense.description })
      lines.push(`• linha ${row}: ${html(expense.date || 'sem data')} · ${html(expense.description)} · ${html(expense.category)} · ${expense.value === null ? '' : brl(expense.value)}`)
    }

    return { plan, preview: lines.join('\n') }
  },

  async apply(plan: Plan, { spreadsheet }) {
    const { client } = spreadsheet
    for (const row of plan.rows) {
      assertUnchanged(row.before, await snapshot(client, row.range, 1, EXPENSE_COLUMNS))
    }

    const undo: UndoOp[] = []
    for (const row of plan.rows) {
      await client.updateValues(row.range, blank(1, EXPENSE_COLUMNS))
      undo.push({ type: 'restore', range: row.range, values: row.before })
    }

    return {
      result: `Apagado: ${plan.rows.map((row) => row.range).join(', ')}.`,
      log: { description: `remoção de ${plan.rows.map((row) => row.description).join(', ')}`, undo }
    }
  }
})

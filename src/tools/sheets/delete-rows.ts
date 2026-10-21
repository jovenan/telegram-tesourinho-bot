import { z } from 'zod'
import { columnLetter } from '../../sheets/a1'
import { snapshot, type UndoOp } from '../../sheets/undo'
import type { CellValue } from '../../sheets/client'
import { defineWriteTool, ToolError } from '../registry'
import { nonMonthTab } from './append-rows'
import { assertUnchanged, html, MAX_DELETE_ROWS } from './shared'

interface Plan {
  sheet: string
  columns: number
  rows: Array<{ row: number; before: CellValue[][] }>
}

export const deleteRows = defineWriteTool({
  name: 'delete_rows',
  description:
    'Remove linhas inteiras de uma aba que NÃO é de gastos (as linhas abaixo sobem). Para lançamentos de gastos use delete_expenses. O usuário aprova antes.',
  kind: 'write',
  input: z.strictObject({
    sheet: z.string().describe('Nome exato da aba'),
    rows: z.array(z.number().int()).describe('Números das linhas a remover')
  }),

  async prepare({ sheet, rows }, { spreadsheet }) {
    const tab = await nonMonthTab(spreadsheet, sheet)
    const unique = [...new Set(rows)].sort((a, b) => b - a)
    if (unique.length === 0) throw new ToolError('Nenhuma linha informada.')
    if (unique.length > MAX_DELETE_ROWS) throw new ToolError(`Máximo de ${MAX_DELETE_ROWS} linhas por vez.`)
    if (unique.some((row) => row < 1 || row > tab.rowCount)) throw new ToolError(`Linhas válidas: 1 a ${tab.rowCount}.`)

    const plan: Plan = { sheet: tab.title, columns: tab.columnCount, rows: [] }
    const lines = [`🗑️ <b>Remover ${unique.length} linha(s) de ${html(tab.title)}</b>`]
    for (const row of [...unique].reverse()) {
      const range = spreadsheet.client.range(tab.title, `A${row}:${columnLetter(tab.columnCount - 1)}${row}`)
      const before = await snapshot(spreadsheet.client, range, 1, tab.columnCount)
      plan.rows.unshift({ row, before })
      lines.push(`• linha ${row}: ${html(before[0].filter((cell) => String(cell).trim()).join(' · ')) || '<i>vazia</i>'}`)
    }

    return { plan, preview: lines.join('\n') }
  },

  async apply(plan: Plan, { spreadsheet }) {
    const { client } = spreadsheet
    const tab = await nonMonthTab(spreadsheet, plan.sheet)
    const lastColumn = columnLetter(plan.columns - 1)

    for (const { row, before } of plan.rows) {
      assertUnchanged(before, await snapshot(client, client.range(tab.title, `A${row}:${lastColumn}${row}`), 1, plan.columns))
    }

    // Rows are sorted bottom-up so earlier deletions do not shift later ones.
    await client.batchUpdate(
      plan.rows.map(({ row }) => ({
        deleteDimension: { range: { sheetId: tab.sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row } }
      }))
    )

    const undo: UndoOp[] = plan.rows.map(({ row, before }) => ({ type: 'reinsert_rows', sheet: tab.title, startIndex: row - 1, values: before }))
    return {
      result: `Removidas as linhas ${plan.rows.map((r) => r.row).join(', ')} de ${tab.title}.`,
      log: { description: `remoção de ${plan.rows.length} linha(s) de ${tab.title}`, undo }
    }
  }
})

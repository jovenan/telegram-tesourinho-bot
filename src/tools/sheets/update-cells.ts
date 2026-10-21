import { z } from 'zod'
import { EXPENSE_FIRST_ROW, INCOME_ROWS } from '../../sheets/expenses'
import { columnIndex, columnLetter, parseCell, rangeFrom } from '../../sheets/a1'
import { snapshot } from '../../sheets/undo'
import { defineWriteTool, ToolError } from '../registry'
import { assertCleanValues, assertUnchanged, canonicalOption, html, optionsLoader } from './shared'

interface Plan {
  range: string
  values: string[][]
  before: (string | number | boolean)[][]
}

const MAX_CELLS = 50

export const updateCells = defineWriteTool({
  name: 'update_cells',
  description:
    'Altera células existentes de uma aba a partir de uma célula inicial (ex: corrigir categoria de um gasto: start_cell "F12", values [["Lazer"]]). Não use para lançar gastos novos (use add_expense). Em abas de gastos só é permitido mexer na tabela (C–G) e nos lançamentos de renda (A2:B5, apenas se o usuário pedir). Valores em formato brasileiro ("45,90", "15/10/2026"). O usuário aprova antes.',
  kind: 'write',
  input: z.strictObject({
    sheet: z.string().describe('Nome exato da aba'),
    start_cell: z.string().describe('Célula inicial, ex: "F12"'),
    values: z.array(z.array(z.string())).describe('Linhas de valores a escrever a partir da célula inicial')
  }),

  async prepare({ sheet, start_cell, values }, { spreadsheet }) {
    const tab = await spreadsheet.tab(sheet)
    const start = parseCell(start_cell)
    if (!start) throw new ToolError(`Célula inválida: "${start_cell}".`)

    const rows = values.length
    const columns = Math.max(0, ...values.map((row) => row.length))
    if (rows === 0 || columns === 0) throw new ToolError('Nenhum valor informado.')
    if (rows * columns > MAX_CELLS) throw new ToolError(`Máximo de ${MAX_CELLS} células por alteração.`)
    const padded = values.map((row) => Array.from({ length: columns }, (_, c) => row[c] ?? ''))
    assertCleanValues(padded)

    if (start.row + rows - 1 > tab.rowCount || start.column + columns > tab.columnCount) {
      throw new ToolError(`A aba ${tab.title} tem ${tab.rowCount} linhas e ${tab.columnCount} colunas; a alteração passa disso. Para gastos novos use add_expense, que aumenta a tabela.`)
    }

    if (await spreadsheet.isExpenseTab(tab.title)) {
      const lastRow = start.row + rows - 1
      const lastColumn = start.column + columns - 1
      const inExpenses = start.column >= columnIndex('C') && lastColumn <= columnIndex('G') && start.row >= EXPENSE_FIRST_ROW
      const inIncome = start.column >= 0 && lastColumn <= columnIndex('B') && start.row >= INCOME_ROWS.first && lastRow <= INCOME_ROWS.last
      if (!inExpenses && !inIncome) {
        throw new ToolError('Em abas de gastos só dá para alterar a tabela (C–G) ou os lançamentos de renda (A2:B5). O resto do painel é calculado por fórmulas.')
      }

      // Dropdown columns only accept their list values.
      if (inExpenses) {
        const { sources, categories } = await optionsLoader(spreadsheet)(tab.title)
        padded.forEach((row) =>
          row.forEach((value, c) => {
            const column = start.column + c
            if (!value) return
            if (column === columnIndex('E')) row[c] = canonicalOption(value, sources, 'Fonte')
            if (column === columnIndex('F')) row[c] = canonicalOption(value, categories, 'Categoria')
          })
        )
      }
    }

    const range = spreadsheet.client.range(tab.title, rangeFrom(start, rows, columns))
    const before = await snapshot(spreadsheet.client, range, rows, columns)

    const changes = padded.flatMap((row, r) =>
      row.map((value, c) => {
        const cell = `${columnLetter(start.column + c)}${start.row + r}`
        return `• ${cell}: ${html(String(before[r][c] ?? '')) || '<i>vazio</i>'} → <b>${html(value) || '<i>vazio</i>'}</b>`
      })
    )
    const preview = [`✏️ <b>Alterar ${html(tab.title)}</b>`, ...changes].join('\n')
    return { plan: { range, values: padded, before }, preview }
  },

  async apply(plan: Plan, { spreadsheet }) {
    const { client } = spreadsheet
    assertUnchanged(plan.before, await snapshot(client, plan.range, plan.before.length, plan.before[0].length))
    await client.updateValues(plan.range, plan.values)
    return {
      result: `Alterado: ${plan.range}.`,
      log: { description: `alteração em ${plan.range}`, undo: [{ type: 'restore' as const, range: plan.range, values: plan.before }] }
    }
  }
})

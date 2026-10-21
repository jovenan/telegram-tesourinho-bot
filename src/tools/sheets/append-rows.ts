import { z } from 'zod'
import { columnLetter } from '../../sheets/a1'
import { blank } from '../../sheets/undo'
import type { Spreadsheet } from '../../sheets/expenses'
import { defineWriteTool, ToolError } from '../registry'
import { assertCleanValues, html, MAX_ROWS_PER_WRITE } from './shared'

interface Plan {
  sheet: string
  rows: string[][]
}

async function nonMonthTab(spreadsheet: Spreadsheet, sheet: string) {
  const tab = await spreadsheet.tab(sheet)
  if (await spreadsheet.isExpenseTab(tab.title)) {
    throw new ToolError('Para abas de gastos use add_expense (gastos) ou add_income (renda).')
  }
  return tab
}

export const appendRows = defineWriteTool({
  name: 'append_rows',
  description:
    'Adiciona linhas ao final de uma aba que NÃO é de gastos (ex: planejamento, viagem), a partir da coluna A. Valores em formato brasileiro. O usuário aprova antes.',
  kind: 'write',
  input: z.strictObject({
    sheet: z.string().describe('Nome exato da aba'),
    rows: z.array(z.array(z.string())).describe('Linhas a adicionar, cada uma com os valores a partir da coluna A')
  }),

  async prepare({ sheet, rows }, { spreadsheet }) {
    const tab = await nonMonthTab(spreadsheet, sheet)
    if (rows.length === 0) throw new ToolError('Nenhuma linha informada.')
    if (rows.length > MAX_ROWS_PER_WRITE) throw new ToolError(`Máximo de ${MAX_ROWS_PER_WRITE} linhas por vez.`)
    assertCleanValues(rows)

    const preview = [`➕ <b>Adicionar ${rows.length} linha(s) em ${html(tab.title)}</b>`, ...rows.slice(0, 20).map((row) => `• ${html(row.join(' · '))}`)]
    if (rows.length > 20) preview.push(`… e mais ${rows.length - 20}`)
    return { plan: { sheet: tab.title, rows }, preview: preview.join('\n') }
  },

  async apply(plan: Plan, { spreadsheet }) {
    const { client } = spreadsheet
    const tab = await nonMonthTab(spreadsheet, plan.sheet)
    const width = Math.max(...plan.rows.map((row) => row.length))
    const lastColumn = columnLetter(Math.max(tab.columnCount, width) - 1)

    const values = await client.getValues(client.range(tab.title, `A1:${lastColumn}${tab.rowCount}`))
    let lastUsed = 0
    values.forEach((row, i) => {
      if (row.some((cell) => String(cell ?? '').trim())) lastUsed = i + 1
    })

    const start = lastUsed + 1
    const end = start + plan.rows.length - 1
    if (end > tab.rowCount) {
      await client.batchUpdate([{ appendDimension: { sheetId: tab.sheetId, dimension: 'ROWS', length: end - tab.rowCount } }])
    }

    const padded = plan.rows.map((row) => Array.from({ length: width }, (_, c) => row[c] ?? ''))
    const range = client.range(tab.title, `A${start}:${columnLetter(width - 1)}${end}`)
    await client.updateValues(range, padded)
    return {
      result: `Adicionado em ${range}.`,
      log: { description: `${plan.rows.length} linha(s) em ${tab.title}`, undo: [{ type: 'restore' as const, range, values: blank(plan.rows.length, width) }] }
    }
  }
})

export { nonMonthTab }

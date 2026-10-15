import { z } from 'zod'
import { INCOME_ROWS, sheetNumber } from '../../sheets/expenses'
import { snapshot } from '../../sheets/undo'
import { defineWriteTool, ToolError } from '../registry'
import { assertUnchanged, brl, html } from './shared'
import { monthField, requireMonth } from './month'

interface Plan {
  range: string
  values: string[][]
  before: (string | number | boolean)[][]
}

export const addIncome = defineWriteTool({
  name: 'add_income',
  description:
    'Lança uma renda na seção "Renda" (A2:B5) da aba de um mês, na primeira linha livre. Use SOMENTE quando o usuário pedir explicitamente para lançar uma renda. O usuário aprova antes.',
  kind: 'write',
  input: z.strictObject({
    month: monthField,
    description: z.string().describe('Descrição da renda, ex: "Freela site"'),
    value: z.number().describe('Valor em reais, positivo')
  }),

  async prepare({ month, description, value }, { spreadsheet }) {
    if (!(value > 0)) throw new ToolError(`Valor inválido: ${value}.`)
    const tab = spreadsheet.monthTabTitle(requireMonth(month))
    await spreadsheet.tab(tab)

    const area = await snapshot(spreadsheet.client, spreadsheet.client.range(tab, `A${INCOME_ROWS.first}:B${INCOME_ROWS.last}`), INCOME_ROWS.last - INCOME_ROWS.first + 1, 2)
    const free = area.findIndex(([label, amount]) => !String(label).trim() && !String(amount).trim())
    if (free === -1) {
      throw new ToolError('A seção de renda (A2:B5) está cheia. Para mudar um lançamento existente, use update_cells na linha dele.')
    }

    const row = INCOME_ROWS.first + free
    const range = spreadsheet.client.range(tab, `A${row}:B${row}`)
    return {
      plan: { range, values: [[description, sheetNumber(value)]], before: [area[free]] },
      preview: `💵 <b>Lançar renda em ${html(tab)}</b>\n• linha ${row}: ${html(description)} · <b>${brl(value)}</b>`
    }
  },

  async apply(plan: Plan, { spreadsheet }) {
    const { client } = spreadsheet
    assertUnchanged(plan.before, await snapshot(client, plan.range, 1, 2))
    await client.updateValues(plan.range, plan.values)
    return {
      result: `Renda lançada em ${plan.range}.`,
      log: { description: `renda "${plan.values[0][0]}"`, undo: [{ type: 'restore' as const, range: plan.range, values: plan.before }] }
    }
  }
})

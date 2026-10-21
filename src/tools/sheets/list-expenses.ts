import { z } from 'zod'
import { defineTool } from '../registry'
import { normalize } from './shared'
import { formatBrl } from '../../sheets/expenses'
import { expenseTabTitle, tabFields } from './month'

const MAX_LINES = 200

export const listExpenses = defineTool({
  name: 'list_expenses',
  description:
    'Lista os gastos (tabela C–G) da aba de um mês, com número da linha, data, descrição, fonte, categoria e valor. Filtros opcionais por categoria, fonte e texto na descrição. Retorna também quantidade e total dos itens filtrados.',
  kind: 'read',
  input: z.strictObject({
    ...tabFields,
    category: z.string().optional().describe('Filtra pela categoria exata'),
    source: z.string().optional().describe('Filtra pela fonte de saída exata'),
    text: z.string().optional().describe('Filtra por texto contido na descrição')
  }),
  async execute({ month, sheet, category, source, text }, { spreadsheet }) {
    const title = expenseTabTitle(spreadsheet, { month, sheet })
    const all = await spreadsheet.expensesIn(title)

    const filtered = all.filter(
      (expense) =>
        (!category || normalize(expense.category) === normalize(category)) &&
        (!source || normalize(expense.source) === normalize(source)) &&
        (!text || normalize(expense.description).includes(normalize(text)))
    )

    const total = filtered.reduce((sum, expense) => sum + (expense.value ?? 0), 0)
    const header = `${title}: ${filtered.length} de ${all.length} gastos, total ${formatBrl(total)}`
    if (filtered.length === 0) return header

    const lines = filtered
      .slice(0, MAX_LINES)
      .map(
        (e) =>
          `linha ${e.row} | ${e.date || 'sem data'} | ${e.description} | ${e.source || '-'} | ${e.category || '-'} | ${
            e.value === null ? 'valor inválido' : formatBrl(e.value)
          }`
      )
    const more = filtered.length > MAX_LINES ? `\n(+${filtered.length - MAX_LINES} não mostrados)` : ''
    return `${header}\n${lines.join('\n')}${more}`
  }
})

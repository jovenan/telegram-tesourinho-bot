import { z } from 'zod'
import { defineTool } from '../registry'
import { expenseTabTitle, tabFields } from './month'

export const listOptions = defineTool({
  name: 'list_options',
  description:
    'Lista as fontes de saída e categorias válidas (os dropdowns das colunas E e F) da aba de um mês.',
  kind: 'read',
  input: z.strictObject(tabFields),
  async execute({ month }, { spreadsheet }) {
    const { sources, categories } = await spreadsheet.optionsIn(expenseTabTitle(spreadsheet, { month }))
    return `Fontes: ${sources.join(', ') || '(nenhuma)'}\nCategorias: ${categories.join(', ') || '(nenhuma)'}`
  }
})

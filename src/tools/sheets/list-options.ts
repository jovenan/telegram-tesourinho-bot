import { z } from 'zod'
import { defineTool } from '../registry'
import { monthField, requireMonth } from './month'

export const listOptions = defineTool({
  name: 'list_options',
  description:
    'Lista as fontes de saída e categorias válidas (os dropdowns das colunas E e F) da aba de um mês.',
  kind: 'read',
  input: z.strictObject({ month: monthField }),
  async execute({ month }, { spreadsheet }) {
    const { sources, categories } = await spreadsheet.options(requireMonth(month))
    return `Fontes: ${sources.join(', ') || '(nenhuma)'}\nCategorias: ${categories.join(', ') || '(nenhuma)'}`
  }
})

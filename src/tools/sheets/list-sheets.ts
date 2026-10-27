import { z } from 'zod'
import { defineTool } from '../registry'

export const listSheets = defineTool({
  name: 'list_sheets',
  description: 'Lista as abas mensais da planilha ("Gastos MM/AAAA") que estão visíveis. Meses ocultos e outras abas não são acessíveis.',
  kind: 'read',
  input: z.strictObject({}),
  async execute(_, { spreadsheet }) {
    const tabs = await spreadsheet.tabs()
    if (tabs.length === 0) return 'Nenhuma aba mensal visível encontrada.'
    return tabs.map((tab) => `${tab.title} — ${tab.rowCount} linhas`).join('\n')
  }
})

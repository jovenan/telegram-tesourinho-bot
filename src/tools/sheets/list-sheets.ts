import { z } from 'zod'
import { defineTool } from '../registry'

export const listSheets = defineTool({
  name: 'list_sheets',
  description:
    'Lista as abas da planilha. Por padrão mostra só as visíveis; abas ocultas (meses antigos, faturas, planejamento) só quando o usuário pedir algo delas.',
  kind: 'read',
  input: z.strictObject({
    include_hidden: z.boolean().optional().describe('Inclui abas ocultas')
  }),
  async execute({ include_hidden }, { spreadsheet }) {
    const tabs = await spreadsheet.tabs(include_hidden ?? false)
    if (tabs.length === 0) return 'Nenhuma aba encontrada.'
    return tabs.map((tab) => `${tab.title}${tab.hidden ? ' (oculta)' : ''} — ${tab.rowCount} linhas`).join('\n')
  }
})

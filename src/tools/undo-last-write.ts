import { z } from 'zod'
import { applyUndo, type UndoOp } from '../sheets/undo'
import { defineWriteTool, ToolError } from './registry'
import { html } from './sheets/shared'

interface Plan {
  id: number
  description: string
  undo: UndoOp[]
}

export const undoLastWrite = defineWriteTool({
  name: 'undo_last_write',
  description: 'Desfaz a última escrita feita pelo assistente na planilha (restaura os valores anteriores). O usuário aprova antes.',
  kind: 'write',
  input: z.strictObject({}),

  async prepare(_, { writes }) {
    const last = writes.lastActive()
    if (!last) throw new ToolError('Não há escrita para desfazer.')
    const when = new Date(last.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
    return {
      plan: { id: last.id, description: last.description, undo: last.undo },
      preview: `↩️ <b>Desfazer</b>\n• ${html(last.description)} (${when})`
    }
  },

  async apply(plan: Plan, { spreadsheet, writes }) {
    await applyUndo(spreadsheet.client, plan.undo)
    writes.markUndone(plan.id)
    return { result: `Desfeito: ${plan.description}.` }
  }
})

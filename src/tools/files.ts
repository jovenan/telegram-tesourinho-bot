import { z } from 'zod'
import { defineTool, ToolError } from './registry'

const MAX_ROWS = 100

export const readFile = defineTool({
  name: 'read_file',
  description:
    'Lê linhas de um arquivo CSV enviado pelo usuário (o id aparece na mensagem dele). A linha 0 é o cabeçalho. Leia em blocos de até 100 linhas.',
  kind: 'read',
  input: z.strictObject({
    file_id: z.string().describe('Id do arquivo'),
    offset: z.number().int().optional().describe('Primeira linha a ler (padrão 0)'),
    limit: z.number().int().optional().describe(`Quantidade de linhas (máximo ${MAX_ROWS})`)
  }),
  async execute({ file_id, offset, limit }, { files }) {
    const file = files.get(file_id)
    if (!file) throw new ToolError(`Arquivo ${file_id} não encontrado.`)

    const start = Math.max(0, offset ?? 0)
    const count = Math.min(MAX_ROWS, Math.max(1, limit ?? MAX_ROWS))
    const rows = file.rows.slice(start, start + count)
    const lines = rows.map((row, i) => `${start + i} | ${row.join(' | ')}`)
    const end = start + rows.length
    const more = end < file.rows.length ? `\n(linhas ${end} a ${file.rows.length - 1} ainda não lidas)` : ''
    return `${file.name}: ${file.rows.length} linhas (incluindo cabeçalho)\n${lines.join('\n')}${more}`
  }
})

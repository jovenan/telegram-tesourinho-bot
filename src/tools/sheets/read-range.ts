import { z } from 'zod'
import { defineTool, ToolError } from '../registry'
import { columnLetter } from '../../sheets/a1'

const MAX_CELLS = 1500

export const readRange = defineTool({
  name: 'read_range',
  description:
    'Lê um intervalo de qualquer aba em notação A1 (sem o nome da aba), ex: "A1:G40". Use para abas que não seguem o formato mensal ou para ver células específicas. Para gastos do mês prefira list_expenses ou month_summary.',
  kind: 'read',
  input: z.strictObject({
    sheet: z.string().describe('Nome exato da aba, como retornado por list_sheets'),
    range: z.string().describe('Intervalo A1 sem o nome da aba, ex: "A1:G40"')
  }),
  async execute({ sheet, range }, { spreadsheet }) {
    const match = range.match(/^([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/i)
    if (!match) throw new ToolError(`Intervalo inválido: "${range}". Use notação A1, ex: "A1:G40".`)

    const values = await spreadsheet.readRange(sheet, range)
    const cells = values.reduce((total, row) => total + row.length, 0)
    if (cells > MAX_CELLS) {
      throw new ToolError(`O intervalo tem ${cells} células (máximo ${MAX_CELLS}). Leia um pedaço menor.`)
    }
    if (values.length === 0) return `${sheet}!${range}: vazio.`

    const firstRow = Number(match[2] ?? 1)
    const firstColumn = match[1].toUpperCase().split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1
    const header = values[0].map((_, i) => columnLetter(firstColumn + i)).join(' | ')

    const lines = values.map((row, i) => `${firstRow + i} | ${row.map((cell) => String(cell ?? '')).join(' | ')}`)
    return [`${sheet}!${range}`, `linha | ${header}`, ...lines].join('\n')
  }
})

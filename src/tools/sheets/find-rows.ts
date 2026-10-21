import { z } from 'zod'
import { defineTool } from '../registry'
import { normalize } from './shared'
import { columnLetter } from '../../sheets/a1'

const MAX_RESULTS = 40

export const findRows = defineTool({
  name: 'find_rows',
  description:
    'Procura um texto (sem diferenciar maiúsculas e acentos) em todas as células de uma aba e retorna as linhas encontradas com o número da linha.',
  kind: 'read',
  input: z.strictObject({
    sheet: z.string().describe('Nome exato da aba'),
    text: z.string().describe('Texto a procurar')
  }),
  async execute({ sheet, text }, { spreadsheet }) {
    const tab = await spreadsheet.tab(sheet)
    const values = await spreadsheet.readRange(sheet, `A1:${columnLetter(Math.max(tab.columnCount - 1, 0))}${tab.rowCount}`)
    const needle = normalize(text)

    const matches = values
      .map((row, i) => ({ row: i + 1, cells: row.map((cell) => String(cell ?? '')) }))
      .filter(({ cells }) => cells.some((cell) => normalize(cell).includes(needle)))

    if (matches.length === 0) return `Nada encontrado para "${text}" em ${sheet}.`

    const lines = matches.slice(0, MAX_RESULTS).map(({ row, cells }) => {
      const filled = cells.map((cell, i) => (cell ? `${columnLetter(i)}: ${cell}` : '')).filter(Boolean)
      return `linha ${row} | ${filled.join(' | ')}`
    })
    const more = matches.length > MAX_RESULTS ? `\n(+${matches.length - MAX_RESULTS} linhas não mostradas)` : ''
    return `${matches.length} linha(s) em ${sheet}:\n${lines.join('\n')}${more}`
  }
})

import { z } from 'zod'
import { normalizeMonth, type Spreadsheet } from '../../sheets/expenses'
import { ToolError } from '../registry'

export const monthField = z.string().describe('Mês no formato MM/AAAA, ex: 10/2026')

export const tabFields = {
  month: monthField.optional().describe('Mês no formato MM/AAAA (usa a aba mensal desse mês)'),
  sheet: z
    .string()
    .optional()
    .describe('Nome exato de outra aba com o mesmo layout de gastos (ex: uma cópia). Use no lugar do mês quando o usuário apontar uma aba específica')
}

export function requireMonth(input: string): string {
  const month = normalizeMonth(input)
  if (!month) throw new ToolError(`Mês inválido: "${input}". Use MM/AAAA.`)
  return month
}

// The expense tab a tool call refers to: an explicit tab name, or the month's tab.
export function expenseTabTitle(spreadsheet: Spreadsheet, { month, sheet }: { month?: string; sheet?: string }): string {
  if (sheet) return sheet
  if (!month) throw new ToolError('Informe o mês (MM/AAAA) ou o nome da aba.')
  return spreadsheet.monthTabTitle(requireMonth(month))
}

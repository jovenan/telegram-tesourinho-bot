import { z } from 'zod'
import { normalizeMonth, type Spreadsheet } from '../../sheets/expenses'
import { ToolError } from '../registry'

export const monthField = z.string().describe('Mês no formato MM/AAAA, ex: 10/2026')

export const tabFields = {
  month: monthField.describe('Mês no formato MM/AAAA (usa a aba mensal desse mês)')
}

export function requireMonth(input: string): string {
  const month = normalizeMonth(input)
  if (!month) throw new ToolError(`Mês inválido: "${input}". Use MM/AAAA.`)
  return month
}

// The month tab a tool call refers to.
export function expenseTabTitle(spreadsheet: Spreadsheet, { month }: { month: string }): string {
  return spreadsheet.monthTabTitle(requireMonth(month))
}

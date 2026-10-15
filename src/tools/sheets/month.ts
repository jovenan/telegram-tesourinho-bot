import { z } from 'zod'
import { normalizeMonth } from '../../sheets/expenses'
import { ToolError } from '../registry'

export const monthField = z.string().describe('Mês no formato MM/AAAA, ex: 10/2026')

export function requireMonth(input: string): string {
  const month = normalizeMonth(input)
  if (!month) throw new ToolError(`Mês inválido: "${input}". Use MM/AAAA.`)
  return month
}

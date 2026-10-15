import { defineTool } from '../registry'
import { z } from 'zod'
import { formatBrl } from '../../sheets/expenses'
import { monthField, requireMonth } from './month'

export const monthSummary = defineTool({
  name: 'month_summary',
  description:
    'Resumo de um mês: o painel da planilha (Renda, totais de Gastos por fonte e Saldos, calculados pela própria planilha) e os totais por categoria. Use para perguntas de totais, saldo e "quanto gastei".',
  kind: 'read',
  input: z.strictObject({ month: monthField }),
  async execute({ month }, { spreadsheet }) {
    const monthLabel = requireMonth(month)
    const [panel, expenses] = await Promise.all([spreadsheet.panel(monthLabel), spreadsheet.expenses(monthLabel)])

    const lines = [`${spreadsheet.monthTabTitle(monthLabel)}`]
    for (const section of panel.sections) {
      lines.push('', `${section.title}:`, ...section.entries.map((entry) => `- ${entry.label}: ${entry.value || '-'}`))
    }

    const byCategory = new Map<string, number>()
    for (const expense of expenses) {
      const key = expense.category || 'Sem categoria'
      byCategory.set(key, (byCategory.get(key) ?? 0) + (expense.value ?? 0))
    }
    const categories = [...byCategory.entries()].sort((a, b) => b[1] - a[1])

    lines.push('', 'Por categoria:', ...categories.map(([name, total]) => `- ${name}: ${formatBrl(total)}`))

    const undated = expenses.filter((expense) => !expense.date).length
    lines.push('', `Lançamentos: ${expenses.length}${undated ? ` (${undated} sem data)` : ''}`)
    return lines.join('\n')
  }
})

import { z } from 'zod'
import { appendExpenses, sheetNumber } from '../../sheets/expenses'
import type { CellValue } from '../../sheets/client'
import { defineWriteTool, ToolError } from '../registry'
import {
  addMonths,
  AI_SUFFIX,
  brl,
  canonicalOption,
  formatDateParts,
  html,
  looksDuplicate,
  MAX_ROWS_PER_WRITE,
  monthOf,
  optionsLoader,
  parseDate
} from './shared'

interface PlannedExpense {
  date: string
  description: string
  source: string
  category: string
  value: number
  duplicateOf?: string
}

interface Plan {
  groups: Array<{ tab: string; expenses: PlannedExpense[] }>
  skipped: Array<{ tab: string; description: string }>
}

const expense = z.strictObject({
  date: z.string().describe('Data do gasto, dd/mm/aaaa'),
  description: z.string().describe('Descrição como no comprovante/extrato (ex: "IFOOD *IFOOD"), sem prefixos como "Compra no débito"'),
  source: z.string().describe('Fonte de saída, exatamente uma das opções do dropdown'),
  category: z.string().describe('Categoria, exatamente uma das opções do dropdown'),
  value: z.number().describe('Valor em reais, positivo. Se parcelado, o valor de CADA parcela'),
  installments: z.number().int().optional().describe('Total de parcelas, se for compra parcelada (ex: 3 para 3x)')
})

export const addExpense = defineWriteTool({
  name: 'add_expense',
  description:
    'Lança um ou mais gastos na tabela de gastos (C–G). Cada gasto vai para a aba do mês da sua data. Passe TODOS os gastos de uma vez (foto com vários itens, extrato). Parcelas viram uma linha por mês, com "(k/n)" na descrição. O usuário vê uma prévia e aprova antes de gravar.',
  kind: 'write',
  input: z.strictObject({
    expenses: z.array(expense).describe('Gastos a lançar')
  }),

  async prepare({ expenses }, { spreadsheet }) {
    if (expenses.length === 0) throw new ToolError('Nenhum gasto informado.')

    // Expand installments into one entry per month.
    const entries = expenses.flatMap((item) => {
      if (!(item.value > 0)) throw new ToolError(`Valor inválido para "${item.description}": ${item.value}.`)
      const date = parseDate(item.date)
      const count = item.installments && item.installments > 1 ? item.installments : 1
      return Array.from({ length: count }, (_, k) => {
        const when = addMonths(date, k)
        // The suffix is added when writing; drop it if the model already included it.
        const description = item.description.replace(/\s*-\s*AI GENERATED\s*$/i, '').trim()
        return {
          tab: spreadsheet.monthTabTitle(monthOf(when)),
          date: formatDateParts(when),
          description: count > 1 ? `${description} (${k + 1}/${count})` : description,
          source: item.source,
          category: item.category,
          value: item.value
        }
      })
    })
    if (entries.length > MAX_ROWS_PER_WRITE) {
      throw new ToolError(`São ${entries.length} linhas; o máximo por vez é ${MAX_ROWS_PER_WRITE}. Divida em partes.`)
    }

    const options = optionsLoader(spreadsheet)
    const plan: Plan = { groups: [], skipped: [] }

    for (const tab of [...new Set(entries.map((entry) => entry.tab))]) {
      const items = entries.filter((entry) => entry.tab === tab)

      if (!(await spreadsheet.hasTab(tab))) {
        plan.skipped.push(...items.map((item) => ({ tab, description: item.description })))
        continue
      }

      const { sources, categories } = await options(tab)
      const existing = await spreadsheet.expensesIn(tab)

      plan.groups.push({
        tab,
        expenses: items.map((item) => {
          const duplicate = existing.find((row) => looksDuplicate(row, item))
          return {
            date: item.date,
            description: item.description,
            source: canonicalOption(item.source, sources, 'Fonte'),
            category: canonicalOption(item.category, categories, 'Categoria'),
            value: item.value,
            ...(duplicate ? { duplicateOf: `linha ${duplicate.row}: ${duplicate.description}, ${brl(duplicate.value ?? 0)}` } : {})
          }
        })
      })
    }

    if (plan.groups.length === 0) {
      throw new ToolError(`Nenhuma das abas existe (ou estão ocultas): ${[...new Set(plan.skipped.map((s) => s.tab))].join(', ')}. Peça ao usuário para criar ou reexibir a aba do mês.`)
    }

    const count = plan.groups.reduce((n, group) => n + group.expenses.length, 0)
    const total = plan.groups.reduce((sum, group) => sum + group.expenses.reduce((s, e) => s + e.value, 0), 0)
    const lines = [`📝 <b>Lançar ${count} ${count === 1 ? 'gasto' : 'gastos'}</b>`]
    for (const group of plan.groups) {
      lines.push('', `<b>${html(group.tab)}</b>`)
      for (const e of group.expenses) {
        lines.push(`• ${e.date.slice(0, 5)} · ${html(e.description)} · ${html(e.source)} · ${html(e.category)} · <b>${brl(e.value)}</b>`)
        if (e.duplicateOf) lines.push(`   ⚠️ possível duplicado (${html(e.duplicateOf)})`)
      }
    }
    for (const skipped of plan.skipped) {
      lines.push(`⚠️ Sem a aba ${html(skipped.tab)} (inexistente ou oculta): "${html(skipped.description)}" não será lançado.`)
    }
    if (count > 1) lines.push('', `Total: <b>${brl(total)}</b>`)

    return { plan, preview: lines.join('\n') }
  },

  async apply(plan: Plan, { spreadsheet }) {
    const written: string[] = []
    const undo = []

    for (const group of plan.groups) {
      const rows: CellValue[][] = group.expenses.map((e) => [e.date, `${e.description}${AI_SUFFIX}`, e.source, e.category, sheetNumber(e.value)])
      const result = await appendExpenses(spreadsheet, group.tab, rows)
      undo.push(result.undo)
      written.push(`${group.expenses.length} em ${result.range}`)
    }

    const count = plan.groups.reduce((n, group) => n + group.expenses.length, 0)
    const skipped = plan.skipped.length ? ` Não lançados (aba inexistente): ${plan.skipped.map((s) => s.description).join(', ')}.` : ''
    return {
      result: `Gravado: ${written.join('; ')}.${skipped}`,
      log: { description: `lançamento de ${plan.groups.flatMap((g) => g.expenses.map((e) => e.description)).join(', ')}`, undo }
    }
  }
})

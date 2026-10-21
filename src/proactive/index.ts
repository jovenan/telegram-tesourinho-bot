import { formatBrl, type Expense, type Spreadsheet } from '../sheets/expenses'
import { monthSummary } from '../tools/sheets/month-summary'
import type { ToolContext } from '../tools/registry'
import { addDays, dayKey, formatDay, monthLabelOf, parseSheetDate, today, weekday, type CalendarDay } from '../utils/dates'

export type ProactiveKind = 'weekly_reminder' | 'weekly_summary' | 'month_close'

// Cron expressions in UTC (São Paulo is UTC−3, no daylight saving), exactly as in
// wrangler.toml. Day names avoid Cloudflare's 1 = Sunday numbering.
export const CRON_JOBS: Record<string, ProactiveKind> = {
  '0 13 * * sat': 'weekly_reminder', // Saturday 10:00
  '0 22 * * sun': 'weekly_summary', // Sunday 19:00
  '0 12 1 * *': 'month_close' // Day 1, 09:00
}

// A proactive job either sends a ready message (no model call) or asks the agent
// to write one from data computed here.
export type ProactiveAction = { kind: 'message'; html: string } | { kind: 'agent'; prompt: string }

interface DatedExpense extends Expense {
  day: CalendarDay
}

interface Week {
  start: CalendarDay
  end: CalendarDay
}

// Monday..Sunday week containing `day`.
export function weekOf(day: CalendarDay): Week {
  const start = addDays(day, -((weekday(day) + 6) % 7))
  return { start, end: addDays(start, 6) }
}

async function expensesIn(spreadsheet: Spreadsheet, weeks: Week[]): Promise<{ dated: DatedExpense[]; undated: number }> {
  const months = new Set<string>()
  for (const week of weeks) {
    months.add(monthLabelOf(week.start))
    months.add(monthLabelOf(week.end))
  }

  const dated: DatedExpense[] = []
  let undated = 0
  for (const month of months) {
    if (!(await spreadsheet.hasTab(spreadsheet.monthTabTitle(month)))) continue
    for (const expense of await spreadsheet.expenses(month)) {
      const day = parseSheetDate(expense.date)
      if (day) dated.push({ ...expense, day })
      else undated++
    }
  }
  return { dated, undated }
}

function inWeek(expenses: DatedExpense[], week: Week): DatedExpense[] {
  return expenses.filter((e) => dayKey(e.day) >= dayKey(week.start) && dayKey(e.day) <= dayKey(week.end))
}

function byCategory(expenses: DatedExpense[]): string {
  const totals = new Map<string, number>()
  for (const e of expenses) totals.set(e.category || 'Sem categoria', (totals.get(e.category || 'Sem categoria') ?? 0) + (e.value ?? 0))
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, total]) => `- ${category}: ${formatBrl(total)}`)
    .join('\n')
}

const total = (expenses: DatedExpense[]) => expenses.reduce((sum, e) => sum + (e.value ?? 0), 0)
const weekLabel = (week: Week) => `${formatDay(week.start)} a ${formatDay(week.end)}`

export async function proactiveAction(kind: ProactiveKind, ctx: ToolContext): Promise<ProactiveAction> {
  const { spreadsheet, now } = ctx
  const day = today(now)

  if (kind === 'weekly_reminder') {
    const week = weekOf(day)
    const { dated } = await expensesIn(spreadsheet, [week])
    const thisWeek = inWeek(dated, week)
    const status = thisWeek.length
      ? `Nesta semana (${weekLabel(week)}) constam <b>${thisWeek.length}</b> lançamento(s), somando <b>${formatBrl(total(thisWeek))}</b>.`
      : `Ainda não consta nenhum lançamento nesta semana (${weekLabel(week)}).`
    return {
      kind: 'message',
      html: `🎩 <b>Bom dia, senhor.</b>\n\n${status}\n\nSe algo ficou de fora, basta me enviar aqui: texto, foto do comprovante ou o extrato em CSV.`
    }
  }

  if (kind === 'weekly_summary') {
    const week = weekOf(day)
    const previous = weekOf(addDays(week.start, -1))
    const { dated, undated } = await expensesIn(spreadsheet, [week, previous])
    const current = inWeek(dated, week)
    const before = inWeek(dated, previous)

    return {
      kind: 'agent',
      prompt: `Escreva o resumo semanal de gastos para o usuário: total da semana, comparação com a semana anterior, categorias que mais pesaram e algo que chame atenção. Seja breve. Dados (lançamentos com data na coluna C):

Semana atual (${weekLabel(week)}): ${current.length} lançamentos, total ${formatBrl(total(current))}
${byCategory(current) || '- nenhum'}

Semana anterior (${weekLabel(previous)}): ${before.length} lançamentos, total ${formatBrl(total(before))}
${byCategory(before) || '- nenhum'}

Lançamentos sem data nas abas desses meses (ficaram fora do resumo): ${undated}. Se forem muitos, mencione.`
    }
  }

  const lastMonth = monthLabelOf(addDays({ ...day, day: 1 }, -1))
  const currentMonth = monthLabelOf(day)
  const hasLastMonth = await spreadsheet.hasTab(spreadsheet.monthTabTitle(lastMonth))
  const hasCurrentMonth = await spreadsheet.hasTab(spreadsheet.monthTabTitle(currentMonth))
  const summary = hasLastMonth ? await monthSummary.execute({ month: lastMonth }, ctx) : `A aba de ${lastMonth} não existe.`

  return {
    kind: 'agent',
    prompt: `É o primeiro dia do mês. Escreva o fechamento de ${lastMonth} para o usuário: total gasto, saldo, categorias que mais pesaram e um comentário útil. Seja breve.
${hasCurrentMonth ? `A aba de ${currentMonth} já existe.` : `A aba "${spreadsheet.monthTabTitle(currentMonth)}" ainda NÃO existe: lembre o usuário de criá-la para poder lançar os gastos do mês.`}

Dados de ${lastMonth}:
${summary}`
  }
}

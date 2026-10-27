import { escapeHtml as html } from '../telegram/format'
import type { BatchItem } from './process'

const brl = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ')
const shortDate = (date: string) => date.slice(0, 5)

function mark(item: BatchItem): string {
  if (item.duplicate) return `⚠️ parece a linha ${item.duplicate.row}`
  if (item.suggestion) return `${item.suggestionKind === 'rule' ? '📌' : '🤖'} ${html(item.suggestion)}`
  return '❓'
}

// The batch preview: one line per purchase, grouped by tab.
export function batchPreview(items: BatchItem[], inSheet: number): string {
  const sources = [...new Set(items.map((item) => item.source))].join(', ')
  const total = items.reduce((sum, item) => sum + item.value, 0)
  const lines = [`🏦 <b>Cartão ${html(sources)} — ${items.length + inSheet} transações novas</b>`]
  if (inSheet > 0) lines.push(`${inSheet} já ${inSheet === 1 ? 'estava' : 'estavam'} na planilha.`)
  lines.push('', `Para lançar (${items.length} · ${brl(total)}):`)

  let number = 0
  for (const tab of [...new Set(items.map((item) => item.tab))]) {
    lines.push('', `<b>${html(tab)}</b>`)
    for (const item of items.filter((candidate) => candidate.tab === tab)) {
      number++
      const closing = item.closingDay ? ' · 🗓️ dia do fechamento' : ''
      lines.push(`${number}. ${shortDate(item.date)} · ${html(item.description)} · ${mark(item)} · <b>${brl(item.value)}</b>${closing}`)
    }
  }

  lines.push('', '📌 regra aprendida · 🤖 sugestão da IA · ❓ sem sugestão · ⚠️ possível duplicado')
  if (items.some((item) => item.closingDay)) lines.push('🗓️ comprado no dia do fechamento: confira em qual fatura entrou.')
  return lines.join('\n')
}

export function reviewText(item: BatchItem, position: number, total: number): string {
  const lines = [`<b>${position} de ${total}</b> · ${html(item.description)} — <b>${brl(item.value)}</b> — ${shortDate(item.date)}`, `${html(item.tab)} · ${html(item.source)}`]
  if (item.closingDay) lines.push('🗓️ Dia do fechamento: pode ter entrado na fatura seguinte.')
  if (item.duplicate) {
    const { row, description, date, value } = item.duplicate
    lines.push('', `Parece a linha ${row}: "${html(description)}", ${html(date || 'sem data')}, ${value === null ? '' : brl(value)}`)
  } else if (!item.suggestion) {
    lines.push('', 'Escolha a categoria:')
  }
  return lines.join('\n')
}

export const BANK_MESSAGES = {
  saved: (count: number) => `✅ <b>Gravados ${count}</b>`,
  ignored: '🗑️ <b>Lote ignorado</b>',
  replaced: '🔄 <b>Substituída pela prévia nova</b>',
  failed: (reason: string) => `⚠️ Não consegui gravar: ${html(reason)}`,
  reviewDone: (imported: number, inSheet: number, dropped: number, skipped: number) =>
    [
      '✅ <b>Revisão concluída</b>',
      imported ? `• ${imported} lançado(s)` : '',
      inSheet ? `• ${inSheet} já estava(m) na planilha` : '',
      dropped ? `• ${dropped} não lançado(s)` : '',
      skipped ? `• ${skipped} pulado(s), voltam no próximo lote` : ''
    ]
      .filter(Boolean)
      .join('\n'),
  expired: 'Essa prévia expirou.',
  waitingTab: (tab: string, count: number) =>
    `🏦 Senhor, ${count} compra(s) do cartão vão para a aba <b>${html(tab)}</b>, que ainda não existe (ou está oculta). Assim que ela estiver disponível, entram no próximo lote.`,
  problems: (problems: string[]) => `⚠️ <b>Importação do cartão</b>\n${problems.map((p) => `• ${html(p)}`).join('\n')}`,
  issues: (issues: string[]) => `🏦 <b>Conexão com o banco</b>\n${issues.map((i) => `• ${html(i)}`).join('\n')}\n\nReconecte no Meu Pluggy, por gentileza.`,
  notConfigured: 'A importação do cartão ainda não está configurada, senhor (faltam as credenciais do Pluggy ou os cartões em PLUGGY_ACCOUNTS).',
  syncStarted: '🏦 Consultando o banco, senhor…',
  nothingNew: '🏦 Nada novo no cartão, senhor.',
  allInSheet: (count: number) => `🏦 ${count} compra(s) nova(s) no cartão, e todas já estavam na planilha.`,
  fetchFailed: '⚠️ Não consegui consultar o banco agora. Tento de novo no próximo sync.'
}

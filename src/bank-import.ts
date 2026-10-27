import type Anthropic from '@anthropic-ai/sdk'
import type { Api } from 'grammy'
import type { CallbackQuery, InlineKeyboardMarkup } from 'grammy/types'
import fakeFixture from '../scripts/dev/fixtures/bank-transactions.json'
import { BUDGET_MODEL } from './agent/config'
import type { Usage } from './agent/types'
import { categorize } from './bank/categorize'
import { parseCards, type CardConfig } from './bank/config'
import { importable } from './bank/filter'
import { batchPreview, BANK_MESSAGES, reviewText } from './bank/messages'
import { processTransactions } from './bank/process'
import { FakeBankSource, isoDate, type BankAccount, type BankSource, type FakeTransaction } from './bank/source'
import type { BankTransactionStore, ReviewItem } from './db/stores/bank-transactions'
import type { JobStore } from './db/stores/jobs'
import type { MemoryStore } from './db/stores/memories'
import type { SettingsStore } from './db/stores/settings'
import type { WriteStore } from './db/stores/writes'
import { PluggyClient } from './pluggy/client'
import { PluggySource } from './pluggy/source'
import type { Spreadsheet } from './sheets/expenses'
import { splitMessage } from './telegram/format'
import { bankPreviewKeyboard, bankReconnectKeyboard, bankReviewKeyboard, type parseBankCallback } from './telegram/keyboards'
import { writeExpenses, type ExpenseGroup } from './tools/sheets/expense-plan'
import { canonicalOption } from './tools/sheets/shared'
import { messageTimestamp } from './utils/dates'
import type { Env } from './types'

const DAY_MS = 86_400_000
// The first sync looks this far back; later ones re-read a margin before the last
// sync, for purchases the bank confirmed late (the id dedupe drops repeats).
const FIRST_SYNC_DAYS = 40
const SYNC_MARGIN_DAYS = 10
const PREVIEW_CHUNK = 3800
// Development: the fixture's card, when PLUGGY_ACCOUNTS is not set.
const FAKE_CARDS: CardConfig[] = [{ accountId: 'fake-c6', source: 'C6', dueDay: 5, closingDaysBeforeDue: 7 }]

// The open batch: one at a time, kept in settings.
interface OpenBatch {
  token: string
  // Last preview message (the one with the buttons) and its text, to append a status.
  messageId: number | null
  previewTail: string
  reviewMessageId: number | null
  total: number
  categories: Record<string, string[]>
  stats: { imported: number; inSheet: number; dropped: number; skipped: number }
}

// What was already told to the user, so notices are sent once.
interface Notices {
  manual?: boolean
  issues?: string
  waiting?: string[]
  problems?: string
}

export interface BankImportDeps {
  env: Env
  api: Api
  claude: Anthropic
  spreadsheet: Spreadsheet
  transactions: BankTransactionStore
  settings: SettingsStore
  jobs: JobStore
  writes: WriteStore
  memories: MemoryStore
  chatId(): number | null
  recordUsage(model: string, usage: Usage): Promise<void>
}

// Card import glue: bank fetch and batch processing (jobs), the batch preview and
// review (buttons), /sync and /banco. The decisions live in src/bank.
export class BankImport {
  readonly cards: CardConfig[]

  constructor(private readonly deps: BankImportDeps) {
    const fake = deps.env.BANK_SOURCE === 'fake'
    this.cards = fake && !deps.env.PLUGGY_ACCOUNTS ? FAKE_CARDS : parseCards(deps.env.PLUGGY_ACCOUNTS)
  }

  private source(): BankSource | null {
    const { env } = this.deps
    if (env.BANK_SOURCE === 'fake') return new FakeBankSource(fakeFixture as { accounts: BankAccount[]; transactions: FakeTransaction[] })
    const itemIds = (env.PLUGGY_ITEM_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean)
    if (!env.PLUGGY_CLIENT_ID || !env.PLUGGY_CLIENT_SECRET || itemIds.length === 0) return null
    const client = new PluggyClient({ clientId: env.PLUGGY_CLIENT_ID, clientSecret: env.PLUGGY_CLIENT_SECRET }, env.PLUGGY_API_ROOT)
    return new PluggySource(client, itemIds, this.cards.map((card) => card.accountId))
  }

  configured(): boolean {
    return this.cards.length > 0 && this.source() !== null
  }

  // ── Commands ─────────────────────────────────────────────────────────────────

  // /sync: queues a fetch and remembers to report even when nothing is new.
  requestSync(): string {
    if (!this.configured()) return BANK_MESSAGES.notConfigured
    this.setNotices({ ...this.notices(), manual: true })
    if (!this.deps.jobs.hasPending('bank_fetch')) this.deps.jobs.add('bank_fetch')
    return BANK_MESSAGES.syncStarted
  }

  statusReport(): string {
    if (!this.configured()) return BANK_MESSAGES.notConfigured
    const lastSync = this.deps.settings.get('bank_last_sync')
    const accounts = JSON.parse(this.deps.settings.get('bank_accounts') ?? '[]') as BankAccount[]
    const unconfigured = accounts.filter((account) => account.credit && !this.cards.some((card) => card.accountId === account.id))
    const counts = this.deps.transactions.counts()
    const waiting = this.deps.transactions.waitingTabs()

    const lines = [
      '🏦 <b>Importação do cartão</b>',
      '',
      `Último sync: ${lastSync ? messageTimestamp(new Date(Number(lastSync))) : 'nunca'}`,
      `Cartões: ${this.cards.map((card) => `${card.source} (vence dia ${card.dueDay}, fecha ${card.closingDaysBeforeDue} dias antes)`).join('; ')}`
    ]
    if (unconfigured.length) lines.push(`Cartões sem configuração: ${unconfigured.map((a) => `${a.name} (<code>${a.id}</code>)`).join(', ')}`)
    lines.push(
      '',
      `Em revisão: ${counts.review ?? 0}`,
      `Aguardando aba: ${waiting.length ? waiting.map((w) => `${w.count} em ${w.tab}`).join(', ') : 0}`,
      `Já estavam na planilha: ${counts.in_sheet ?? 0} · lançadas: ${counts.imported ?? 0} · ignoradas: ${counts.ignored ?? 0}`
    )
    return lines.join('\n')
  }

  // ── Jobs ─────────────────────────────────────────────────────────────────────

  async fetch(): Promise<void> {
    const source = this.source()
    if (!source || this.cards.length === 0) {
      await this.reportManual(BANK_MESSAGES.notConfigured)
      return
    }

    const now = Date.now()
    const lastSync = Number(this.deps.settings.get('bank_last_sync') ?? 0)
    const since = isoDate(new Date(lastSync ? lastSync - SYNC_MARGIN_DAYS * DAY_MS : now - FIRST_SYNC_DAYS * DAY_MS))

    let snapshot
    try {
      snapshot = await source.fetch(since)
    } catch (error) {
      console.error('Bank fetch failed', error)
      await this.reportManual(BANK_MESSAGES.fetchFailed)
      return
    }

    this.deps.settings.set('bank_accounts', JSON.stringify(snapshot.accounts))
    this.deps.settings.set('bank_last_sync', String(now))

    const notices = this.notices()
    const issues = snapshot.issues.join('|')
    if (issues && issues !== notices.issues) await this.send(BANK_MESSAGES.issues(snapshot.issues), bankReconnectKeyboard())
    this.setNotices({ ...this.notices(), issues })

    const added = this.deps.transactions.addNew(snapshot.transactions.filter((tx) => importable(tx, this.cards)))
    if (added > 0 || this.deps.transactions.waitingTabs().length > 0) {
      if (!this.deps.jobs.hasPending('bank_process')) this.deps.jobs.add('bank_process')
    } else {
      await this.reportManual(BANK_MESSAGES.nothingNew)
    }
  }

  async process(): Promise<void> {
    const { transactions, spreadsheet } = this.deps
    const fresh = transactions.byState(['new']).length
    let readyWaiting = 0
    for (const { tab, count } of transactions.waitingTabs()) {
      if (await spreadsheet.hasTab(tab)) readyWaiting += count
    }
    if (fresh === 0 && readyWaiting === 0) {
      await this.reportManual(BANK_MESSAGES.nothingNew)
      return
    }

    // A new batch replaces the open one; its items are proposed again.
    const open = this.batch()
    if (open) await this.closeBatch(open, BANK_MESSAGES.replaced, () => transactions.returnReviewToNew())

    const result = await processTransactions(transactions.byState(['new', 'waiting_tab']), {
      cards: this.cards,
      monthTabTitle: (month) => spreadsheet.monthTabTitle(month),
      hasTab: (title) => spreadsheet.hasTab(title),
      expensesIn: (title) => spreadsheet.expensesIn(title),
      optionsIn: (title) => spreadsheet.optionsIn(title),
      resolved: transactions.resolved(),
      categorize: async (items, categories, examples) => {
        const { suggestions, usage } = await categorize(this.deps.claude, BUDGET_MODEL, {
          items,
          categories,
          examples,
          memories: this.deps.memories.list().map((memory) => memory.text)
        })
        if (usage) await this.deps.recordUsage(BUDGET_MODEL, usage).catch((error) => console.error('Usage tracking failed', error))
        return suggestions
      }
    })

    transactions.markInSheet(result.inSheet)
    const notices = this.notices()
    const notified = new Set(notices.waiting ?? [])
    for (const [tab, ids] of result.waiting) {
      transactions.markWaiting(tab, ids)
      if (!notified.has(tab)) await this.send(BANK_MESSAGES.waitingTab(tab, ids.length))
      notified.add(tab)
    }
    const problems = result.problems.join('|')
    if (problems && problems !== notices.problems) await this.send(BANK_MESSAGES.problems(result.problems))
    this.setNotices({ ...this.notices(), waiting: [...notified].filter((tab) => result.waiting.has(tab)), problems })

    if (result.items.length === 0) {
      // Waiting tabs and problems were already reported above.
      const told = result.waiting.size > 0 || result.problems.length > 0
      if (result.inSheet.length) await this.reportManual(BANK_MESSAGES.allInSheet(result.inSheet.length))
      else if (!told) await this.reportManual(BANK_MESSAGES.nothingNew)
      this.setNotices({ ...this.notices(), manual: false })
      return
    }

    transactions.startReview(result.items)
    const suggested = result.items.filter((item) => item.suggestion && !item.duplicate).length
    const batch: OpenBatch = {
      token: crypto.randomUUID().replace(/-/g, '').slice(0, 10),
      messageId: null,
      previewTail: '',
      reviewMessageId: null,
      total: result.items.length,
      categories: result.categories,
      stats: { imported: 0, inSheet: 0, dropped: 0, skipped: 0 }
    }

    const chunks = splitMessage(batchPreview(result.items, result.inSheet.length), PREVIEW_CHUNK)
    for (const [i, chunk] of chunks.entries()) {
      const last = i === chunks.length - 1
      const id = await this.send(chunk, last ? bankPreviewKeyboard(batch.token, suggested, result.items.length) : undefined)
      if (last) {
        batch.messageId = id
        batch.previewTail = chunk
      }
    }
    this.saveBatch(batch)
    this.setNotices({ ...this.notices(), manual: false })
  }

  // ── Buttons ──────────────────────────────────────────────────────────────────

  async handleCallback(query: CallbackQuery, parsed: NonNullable<ReturnType<typeof parseBankCallback>>): Promise<void> {
    const { api } = this.deps
    const chatId = query.message?.chat.id
    const messageId = query.message?.message_id

    if (parsed.action === 'sync') {
      await api.answerCallbackQuery(query.id).catch(() => {})
      if (chatId !== undefined && messageId) await api.editMessageReplyMarkup(chatId, messageId).catch(() => {})
      await this.send(this.requestSync())
      return
    }

    const batch = this.batch()
    if (!batch || batch.token !== parsed.token) {
      await api.answerCallbackQuery(query.id, { text: BANK_MESSAGES.expired }).catch(() => {})
      if (chatId !== undefined && messageId) await api.editMessageReplyMarkup(chatId, messageId).catch(() => {})
      return
    }
    await api.answerCallbackQuery(query.id).catch(() => {})

    const { transactions } = this.deps
    const [order, arg] = parsed.args
    const item = order === undefined ? null : transactions.reviewItem(order)

    switch (parsed.action) {
      case 'save':
        await this.saveSuggested(batch)
        return
      case 'review':
        await this.markPreview(batch, '🔎 <b>Em revisão</b>')
        await this.showNext(batch)
        return
      case 'ignore': {
        await this.closeBatch(batch, BANK_MESSAGES.ignored, () => transactions.setState(transactions.reviewItems().map((i) => i.id), 'ignored'))
        return
      }
    }

    // Item buttons: the item may already be resolved (double tap).
    if (!item) {
      await this.showNext(batch)
      return
    }

    switch (parsed.action) {
      case 'sug':
      case 'cat': {
        const category = parsed.action === 'sug' ? item.suggestion : batch.categories[item.tab]?.[arg ?? -1]
        if (!category) return
        if (await this.write(batch, [{ item, category }])) batch.stats.imported++
        break
      }
      case 'page':
        await this.render(batch, item, arg ?? 0)
        this.saveBatch(batch)
        return
      case 'same':
        transactions.setState([item.id], 'in_sheet')
        batch.stats.inSheet++
        break
      case 'force':
        transactions.clearDuplicate(item.id)
        await this.render(batch, { ...item, duplicate: null }, 0)
        this.saveBatch(batch)
        return
      case 'drop':
        transactions.setState([item.id], 'ignored')
        batch.stats.dropped++
        break
      case 'skip':
        transactions.setState([item.id], 'new')
        batch.stats.skipped++
        break
    }
    this.saveBatch(batch)
    await this.showNext(batch)
  }

  // "Gravar sugeridos": one write for everything with a suggestion; the rest (no
  // suggestion, possible duplicates) goes to the review.
  private async saveSuggested(batch: OpenBatch): Promise<void> {
    const ready = this.deps.transactions.reviewItems().filter((item) => item.suggestion && !item.duplicate)
    if (ready.length > 0 && (await this.write(batch, ready.map((item) => ({ item, category: item.suggestion! }))))) {
      batch.stats.imported += ready.length
      this.saveBatch(batch)
    }

    const remaining = this.deps.transactions.reviewItems()
    await this.markPreview(batch, `${BANK_MESSAGES.saved(batch.stats.imported)}${remaining.length ? ` · ${remaining.length} para revisar` : ''}`)
    if (remaining.length > 0) await this.showNext(batch)
    else this.clearBatch()
  }

  // Writes items through the add_expense writer and logs them for "desfaz".
  private async write(batch: OpenBatch, entries: Array<{ item: ReviewItem; category: string }>): Promise<boolean> {
    const { spreadsheet, transactions, writes } = this.deps
    try {
      const groups: ExpenseGroup[] = []
      for (const { item, category } of entries) {
        const valid = canonicalOption(category, batch.categories[item.tab] ?? [], 'Categoria')
        const group = groups.find((g) => g.tab === item.tab) ?? groups[groups.push({ tab: item.tab, expenses: [] }) - 1]
        group.expenses.push({ date: item.date, description: item.description, source: item.source, category: valid, value: item.value })
      }
      const { description, undo } = await writeExpenses(spreadsheet, groups)
      writes.add(description, undo)
      transactions.markImported(entries.map(({ item, category }) => ({ id: item.id, category })))
      return true
    } catch (error) {
      console.error('Card import write failed', error)
      await this.send(BANK_MESSAGES.failed(error instanceof Error ? error.message : String(error)))
      return false
    }
  }

  private async showNext(batch: OpenBatch): Promise<void> {
    const next = this.deps.transactions.reviewItems()[0]
    if (!next) {
      const { imported, inSheet, dropped, skipped } = batch.stats
      const summary = BANK_MESSAGES.reviewDone(imported, inSheet, dropped, skipped)
      if (batch.reviewMessageId) await this.edit(batch.reviewMessageId, summary)
      else await this.send(summary)
      this.clearBatch()
      return
    }
    await this.render(batch, next, 0)
    this.saveBatch(batch)
  }

  private async render(batch: OpenBatch, item: ReviewItem, page: number): Promise<void> {
    const remaining = this.deps.transactions.reviewItems().length
    const position = batch.total - remaining + 1
    const text = reviewText(item, position, batch.total)
    const keyboard = bankReviewKeyboard(batch.token, item, batch.categories[item.tab] ?? [], page)
    if (batch.reviewMessageId && (await this.edit(batch.reviewMessageId, text, keyboard))) return
    batch.reviewMessageId = await this.send(text, keyboard)
  }

  private async closeBatch(batch: OpenBatch, status: string, settle: () => void): Promise<void> {
    settle()
    await this.markPreview(batch, status)
    if (batch.reviewMessageId) await this.edit(batch.reviewMessageId, status)
    this.clearBatch()
  }

  private async markPreview(batch: OpenBatch, status: string): Promise<void> {
    if (batch.messageId) await this.edit(batch.messageId, `${batch.previewTail}\n\n${status}`)
  }

  // ── State and Telegram ───────────────────────────────────────────────────────

  private batch(): OpenBatch | null {
    const raw = this.deps.settings.get('bank_batch')
    return raw ? (JSON.parse(raw) as OpenBatch) : null
  }

  private saveBatch(batch: OpenBatch): void {
    this.deps.settings.set('bank_batch', JSON.stringify(batch))
  }

  private clearBatch(): void {
    this.deps.settings.set('bank_batch', '')
  }

  private notices(): Notices {
    return JSON.parse(this.deps.settings.get('bank_notices') || '{}') as Notices
  }

  private setNotices(notices: Notices): void {
    this.deps.settings.set('bank_notices', JSON.stringify(notices))
  }

  // Answers a /sync when there is nothing else to show.
  private async reportManual(text: string): Promise<void> {
    if (!this.notices().manual) return
    this.setNotices({ ...this.notices(), manual: false })
    await this.send(text)
  }

  private chatId(): number | null {
    return this.deps.chatId() ?? (Number(this.deps.env.ALLOWED_USER_ID) || null)
  }

  private async send(html: string, replyMarkup?: InlineKeyboardMarkup): Promise<number | null> {
    const chatId = this.chatId()
    if (chatId === null) return null
    const sent = await this.deps.api.sendMessage(chatId, html, { parse_mode: 'HTML', reply_markup: replyMarkup })
    return sent.message_id
  }

  private async edit(messageId: number, html: string, replyMarkup?: InlineKeyboardMarkup): Promise<boolean> {
    const chatId = this.chatId()
    if (chatId === null) return false
    try {
      await this.deps.api.editMessageText(chatId, messageId, html, { parse_mode: 'HTML', reply_markup: replyMarkup })
      return true
    } catch (error) {
      console.warn('Could not edit message', error)
      return false
    }
  }
}

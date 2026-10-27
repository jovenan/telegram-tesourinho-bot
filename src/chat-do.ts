import { DurableObject } from 'cloudflare:workers'
import Anthropic from '@anthropic-ai/sdk'
import type { Api } from 'grammy'
import { GrammyError } from 'grammy'
import type { CallbackQuery, InlineKeyboardMarkup, Message, Update } from 'grammy/types'
import { createDb, prepareDb } from './db'
import { ConversationStore, type Conversation } from './db/stores/conversations'
import { FileStore } from './db/stores/files'
import { InboxStore } from './db/stores/inbox'
import { JobStore, type JobKind } from './db/stores/jobs'
import { MemoryStore } from './db/stores/memories'
import { RunStateStore, type RunState } from './db/stores/run-state'
import { SettingsStore } from './db/stores/settings'
import { UsageStore } from './db/stores/usage'
import { BankTransactionStore } from './db/stores/bank-transactions'
import { UploadStore } from './db/stores/uploads'
import { WriteStore } from './db/stores/writes'
import { createClaude, deleteFile, uploadFile } from './agent/claude'
import {
  BUDGET_ALERT_RATIO,
  BUDGET_MODEL,
  COMPACT_AT_TOKENS,
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
  DEFAULT_MONTHLY_BUDGET_USD,
  MAX_STEPS_PER_TURN,
  MODEL_NAMES,
  type Effort
} from './agent/config'
import { formatUsd, usageDelta } from './agent/cost'
import { compact, runStep, type StepInput } from './agent/loop'
import { interruptedResults, lastUserInput, unresolvedToolUses } from './agent/history'
import { buildSystemPrompt, PROMPT_VERSION } from './agent/prompt'
import type { ContentBlockParam, MessageParam, PendingApproval, ToolResultBlockParam, Usage } from './agent/types'
import { runCommand } from './commands'
import { CHAT_MESSAGES } from './messages'
import { BankImport } from './bank-import'
import { runMaintenance } from './maintenance'
import { proactiveAction, type ProactiveKind } from './proactive'
import { SheetsClient } from './sheets/client'
import { monthTabPattern, Spreadsheet } from './sheets/expenses'
import { createTelegramApi } from './telegram/api'
import { downloadFile, FileTooLargeError, imageMediaType, MAX_IMAGE_BYTES, sniffImageType } from './telegram/files'
import { escapeHtml, markdownToTelegramHtml, splitMessage } from './telegram/format'
import { approvalKeyboard, BUDGET_ACTIONS, budgetKeyboard, parseApproval, parseBankCallback } from './telegram/keyboards'
import { TOOLS } from './tools'
import { applyWrite, toolResult, toolsHash, type ToolContext } from './tools/registry'
import { decodeText, parseCsv } from './utils/csv'
import { messageTimestamp, monthKey, monthLabel } from './utils/dates'
import type { Env } from './types'

// A conversation is bound to the tools and prompt it started with.
const PROMPT_FINGERPRINT = `${toolsHash(TOOLS)}-p${PROMPT_VERSION}`
const CANCELED_TURN_NOTE = '(Pedido cancelado pelo usuário com /cancelar. Não retome esse pedido a menos que ele peça de novo.)'
const CSV_SAMPLE_ROWS = 5
// Room left in each preview message for the status line added after approval.
const PREVIEW_CHUNK = 3800

// A message the user can't send to the agent (unsupported type, file too large).
class UserFacingError extends Error {}

// One instance per Telegram chat. Work is queued in SQLite and processed by the
// alarm handler, one unit per invocation: a queued update, one agent step (a model
// call plus its tools) or a proactive job. This keeps every invocation under the
// free plan's 50-subrequest limit and lets a turn resume after a failure.
export class ChatDO extends DurableObject<Env> {
  private readonly inbox: InboxStore
  private readonly conversations: ConversationStore
  private readonly runState: RunStateStore
  private readonly usage: UsageStore
  private readonly settings: SettingsStore
  private readonly memories: MemoryStore
  private readonly files: FileStore
  private readonly writes: WriteStore
  private readonly jobs: JobStore
  private readonly uploads: UploadStore
  private readonly bank: BankImport
  private readonly api: Api
  private readonly claude: Anthropic
  private readonly spreadsheet: Spreadsheet
  private processing = false

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    const db = createDb(ctx.storage)
    ctx.blockConcurrencyWhile(() => prepareDb(db))

    this.inbox = new InboxStore(db)
    this.conversations = new ConversationStore(db)
    this.runState = new RunStateStore(db)
    this.usage = new UsageStore(db)
    this.settings = new SettingsStore(db)
    this.memories = new MemoryStore(db)
    this.files = new FileStore(db)
    this.writes = new WriteStore(db)
    this.jobs = new JobStore(db)
    this.uploads = new UploadStore(db)
    this.api = createTelegramApi(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_API_ROOT)
    this.claude = createClaude(env.ANTHROPIC_API_KEY)
    this.spreadsheet = new Spreadsheet(
      new SheetsClient({
        account: { clientEmail: env.GOOGLE_CLIENT_EMAIL, privateKey: env.GOOGLE_PRIVATE_KEY },
        spreadsheetId: env.GOOGLE_SPREADSHEET_ID,
        writePrefix: env.SHEETS_SANDBOX_PREFIX,
        tabAccess: monthTabPattern(env.SHEETS_SANDBOX_PREFIX)
      }),
      { sandboxPrefix: env.SHEETS_SANDBOX_PREFIX }
    )
    this.bank = new BankImport({
      env,
      api: this.api,
      claude: this.claude,
      spreadsheet: this.spreadsheet,
      transactions: new BankTransactionStore(db),
      settings: this.settings,
      jobs: this.jobs,
      writes: this.writes,
      memories: this.memories,
      chatId: () => this.chatId(),
      recordUsage: (model, usage) => this.recordUsage(this.chatId() ?? Number(env.ALLOWED_USER_ID), model, usage)
    })
  }

  // ── Entry points ─────────────────────────────────────────────────────────────

  async enqueue(update: Update): Promise<void> {
    // Telegram redelivers updates it considers unacknowledged; ignore duplicates.
    if (!this.inbox.add(update)) return

    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id
    if (chatId !== undefined && this.chatId() !== chatId) this.settings.set('chat_id', String(chatId))

    await this.wake()
  }

  // Text-only view of the latest messages for /debug/messages (staging). Images,
  // PDFs and thinking are left out.
  async debugMessages(limit: number) {
    const summarize = (block: any): string | null => {
      switch (block.type) {
        case 'text':
          return block.text
        case 'tool_use':
          return `→ ${block.name} ${JSON.stringify(block.input)}`
        case 'tool_result':
          return `← ${block.is_error ? 'ERRO ' : ''}${typeof block.content === 'string' ? block.content : JSON.stringify(block.content)}`.slice(0, 600)
        case 'image':
        case 'document':
          return `[${block.type}]`
        case 'compaction':
          return `[resumo] ${String(block.content ?? '').slice(0, 300)}`
        default:
          return null
      }
    }

    return {
      usage: this.usage.get(monthKey(new Date())),
      messages: this.conversations.recent(limit).map((m) => ({
        id: m.id,
        conversation: m.conversationId,
        at: new Date(m.createdAt).toISOString(),
        role: m.role,
        content: (typeof m.content === 'string' ? [m.content] : m.content.map(summarize)).filter((part) => part !== null)
      }))
    }
  }

  async schedule(kind: JobKind): Promise<void> {
    this.jobs.add(kind)
    await this.wake()
  }

  async alarm(): Promise<void> {
    this.processing = true
    try {
      const state = this.runState.get()
      if (state.status === 'running') {
        await this.agentStep(state)
      } else if (this.inbox.next()) {
        await this.processNextUpdate()
      } else if (state.status === 'idle') {
        await this.processNextJob()
      }
    } catch (error) {
      // An uncaught error would make Cloudflare retry the same step over and over.
      console.error('Unexpected failure in alarm', error)
      if (this.runState.get().status === 'running') {
        this.runState.finishRun()
        const chatId = this.chatId()
        if (chatId !== null) await this.send(chatId, CHAT_MESSAGES.internalError).catch(() => {})
      }
    } finally {
      this.processing = false
    }

    if (this.hasWork()) await this.scheduleNextWork()
  }

  private hasWork(): boolean {
    const { status } = this.runState.get()
    return status === 'running' || this.inbox.next() !== null || (status === 'idle' && this.jobs.next() !== null)
  }

  // Setting an alarm while the handler is running stalls it in local dev; the
  // running handler schedules the next unit of work itself once it finishes.
  private async wake(): Promise<void> {
    if (!this.processing) await this.scheduleNextWork()
  }

  private async scheduleNextWork(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now())
    }
  }

  // ── Updates ──────────────────────────────────────────────────────────────────

  private async processNextUpdate(): Promise<void> {
    const next = this.inbox.next()
    if (!next) return

    const chatId = next.update.message?.chat.id ?? next.update.callback_query?.message?.chat.id
    try {
      if (next.update.callback_query) {
        await this.handleCallback(next.update.callback_query)
      } else if (next.update.message) {
        await this.handleMessage(next.update.message)
      }
    } catch (error) {
      // Swallow the error so the alarm is not retried with the same poison update.
      if (!(error instanceof UserFacingError)) console.error('Failed to process update', next.updateId, error)
      if (chatId !== undefined) {
        const text = error instanceof UserFacingError ? error.message : CHAT_MESSAGES.internalError
        await this.send(chatId, text).catch(() => {})
      }
    }

    this.inbox.markProcessed(next.updateId)
  }

  private async handleMessage(message: Message): Promise<void> {
    const chatId = message.chat.id
    const firstName = message.from?.first_name ?? ''
    if (firstName) this.settings.set('user_name', firstName)

    const text = message.text?.trim()
    if (text?.startsWith('/')) {
      const handled = await runCommand(text, {
        firstName: escapeHtml(firstName),
        reply: (html) => this.send(chatId, html),
        newConversation: async () => {
          await this.closePending(CHAT_MESSAGES.discarded)
          this.startConversation()
        },
        cancel: () => this.cancelPending(),
        usageReport: () => this.usageReport(),
        syncBank: () => this.bank.requestSync(),
        bankReport: () => this.bank.statusReport(),
        memoriesReport: () => CHAT_MESSAGES.memories(this.memories.list().map((m) => `#${m.id} ${escapeHtml(m.text)}`))
      })
      if (handled) return
    }

    const content = await this.userContent(message)
    const state = this.runState.get()

    // Answering a preview with text instead of a button: the writes are not made and
    // the message goes to the agent as feedback, in the same user turn.
    if (state.status === 'awaiting_approval' && state.pending) {
      await this.resolvePending(state, 'feedback', content)
      return
    }

    const conversation = await this.currentConversation(chatId)
    const dangling = unresolvedToolUses(this.conversations.messages(conversation))
    this.conversations.append(conversation.id, { role: 'user', content: [...interruptedResults(dangling), ...content] })
    this.runState.startRun()
    await this.api.sendChatAction(chatId, 'typing').catch(() => {})
  }

  // Turns a Telegram message into content blocks for the model: attachments first,
  // then the text, prefixed with when it was sent.
  private async userContent(message: Message): Promise<ContentBlockParam[]> {
    const stamp = `[${messageTimestamp(new Date(message.date * 1000))}]`
    const caption = message.caption?.trim() ?? ''

    if (message.text) return [{ type: 'text', text: `${stamp} ${message.text.trim()}` }]

    if (message.photo?.length) {
      const largest = message.photo[message.photo.length - 1]
      const { bytes } = await this.download(largest.file_id)
      const fileId = await this.upload(bytes, 'foto.jpg', sniffImageType(bytes) ?? 'image/jpeg', MAX_IMAGE_BYTES)
      return [
        { type: 'image', source: { type: 'file', file_id: fileId } },
        { type: 'text', text: `${stamp} (enviou uma foto) ${caption}`.trim() }
      ]
    }

    const document = message.document
    if (document) {
      const name = document.file_name ?? 'arquivo'
      const mime = document.mime_type ?? ''
      const image = imageMediaType(mime || name)

      if (image) {
        const { bytes } = await this.download(document.file_id)
        const fileId = await this.upload(bytes, name, sniffImageType(bytes) ?? image, MAX_IMAGE_BYTES)
        return [
          { type: 'image', source: { type: 'file', file_id: fileId } },
          { type: 'text', text: `${stamp} (enviou a imagem "${name}") ${caption}`.trim() }
        ]
      }

      if (mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
        const { bytes } = await this.download(document.file_id)
        const fileId = await this.upload(bytes, name, 'application/pdf')
        return [
          { type: 'document', source: { type: 'file', file_id: fileId }, title: name },
          { type: 'text', text: `${stamp} (enviou o PDF "${name}") ${caption}`.trim() }
        ]
      }

      if (mime.includes('csv') || name.toLowerCase().endsWith('.csv') || mime === 'text/plain') {
        const { bytes } = await this.download(document.file_id)
        const rows = parseCsv(decodeText(bytes))
        const id = document.file_unique_id
        this.files.add(id, name, rows)
        const sample = rows
          .slice(0, CSV_SAMPLE_ROWS + 1)
          .map((row, i) => `${i} | ${row.join(' | ')}`)
          .join('\n')
        return [
          {
            type: 'text',
            text: `${stamp} (enviou o CSV "${name}", id do arquivo: ${id}, ${rows.length} linhas incluindo o cabeçalho. Primeiras linhas:\n${sample})\n${caption}`.trim()
          }
        ]
      }
    }

    throw new UserFacingError(CHAT_MESSAGES.unsupported)
  }

  // Sends a photo or PDF to the Files API and records it for the daily cleanup.
  private async upload(bytes: Uint8Array, name: string, mediaType: string, maxBytes?: number): Promise<string> {
    if (maxBytes && bytes.byteLength > maxBytes) throw new UserFacingError(CHAT_MESSAGES.fileTooLarge)
    try {
      const fileId = await uploadFile(this.claude, bytes, name, mediaType)
      this.uploads.add(fileId)
      return fileId
    } catch (error) {
      console.error('File upload failed', error)
      throw new UserFacingError(CHAT_MESSAGES.fileFailed)
    }
  }

  private async download(fileId: string) {
    try {
      return await downloadFile(this.api, this.env.TELEGRAM_BOT_TOKEN, fileId, this.env.TELEGRAM_API_ROOT)
    } catch (error) {
      if (error instanceof FileTooLargeError) throw new UserFacingError(CHAT_MESSAGES.fileTooLarge)
      console.error('File download failed', error)
      throw new UserFacingError(CHAT_MESSAGES.fileFailed)
    }
  }

  private async handleCallback(query: CallbackQuery): Promise<void> {
    const chatId = query.message?.chat.id
    if (chatId === undefined) {
      await this.api.answerCallbackQuery(query.id).catch(() => {})
      return
    }

    const bank = parseBankCallback(query.data)
    if (bank) {
      await this.bank.handleCallback(query, bank)
      return
    }

    const approval = parseApproval(query.data)
    if (approval) {
      const state = this.runState.get()
      if (state.status !== 'awaiting_approval' || state.pending?.token !== approval.token) {
        await this.api.answerCallbackQuery(query.id, { text: CHAT_MESSAGES.approvalExpired }).catch(() => {})
        await this.api.editMessageReplyMarkup(chatId, query.message!.message_id).catch(() => {})
        return
      }
      await this.api.answerCallbackQuery(query.id).catch(() => {})
      await this.resolvePending(state, approval.approved ? 'approve' : 'reject')
      return
    }

    await this.api.answerCallbackQuery(query.id).catch(() => {})
    if (query.message) await this.api.editMessageReplyMarkup(chatId, query.message.message_id).catch(() => {})

    switch (query.data) {
      case BUDGET_ACTIONS.raise: {
        const raised = this.raisedBudget()
        this.settings.set('budget_usd', String(raised))
        await this.send(chatId, CHAT_MESSAGES.budgetRaised(formatUsd(raised)))
        break
      }
      case BUDGET_ACTIONS.cheaperModel:
        this.settings.set('model', BUDGET_MODEL)
        await this.send(chatId, CHAT_MESSAGES.budgetModelSwitched(MODEL_NAMES[BUDGET_MODEL]))
        break
      case BUDGET_ACTIONS.keep:
        await this.send(chatId, CHAT_MESSAGES.budgetKept)
        break
    }
  }

  // ── Approvals ────────────────────────────────────────────────────────────────

  // Finishes a step that stopped for approval. Every write gets a tool result (made,
  // refused or failed) so the history stays valid, then the agent runs again to
  // tell the user what happened.
  private async resolvePending(
    state: RunState,
    decision: 'approve' | 'reject' | 'feedback',
    feedback: ContentBlockParam[] = []
  ): Promise<void> {
    const pending = state.pending!
    const conversation = this.conversations.get(state.conversationId!)!
    let results: ToolResultBlockParam[]
    let status: string

    if (decision === 'approve') {
      results = []
      for (const write of pending.writes) {
        results.push(await applyWrite(TOOLS, write, this.toolContext()))
      }
      status = results.some((r) => r.is_error) ? CHAT_MESSAGES.approvedWithErrors : CHAT_MESSAGES.approved
    } else if (decision === 'reject') {
      results = pending.writes.map((w) =>
        toolResult(w.toolUseId, 'O usuário recusou esta alteração (botão Cancelar). Nada foi gravado.', true)
      )
      status = CHAT_MESSAGES.rejected
    } else {
      results = pending.writes.map((w) =>
        toolResult(w.toolUseId, 'O usuário não aprovou e respondeu com a mensagem a seguir. Nada foi gravado.', true)
      )
      status = CHAT_MESSAGES.revising
    }

    await this.markPreview(pending, status)
    this.conversations.append(conversation.id, { role: 'user', content: [...pending.results, ...results, ...feedback] })
    this.runState.nextStep(state.step)
  }

  // /cancelar: stops a pending approval. Returns false when there is none (a running
  // turn is canceled before its next step instead, see consumeCancelRequest).
  private async cancelPending(): Promise<boolean> {
    const state = this.runState.get()
    if (state.status !== 'awaiting_approval' || !state.pending) return false

    const conversation = this.conversations.get(state.conversationId!)!
    const results = state.pending.writes.map((w) => toolResult(w.toolUseId, 'Cancelado pelo usuário com /cancelar.', true))
    this.conversations.append(conversation.id, { role: 'user', content: [...state.pending.results, ...results] })
    this.conversations.append(conversation.id, { role: 'assistant', content: [{ type: 'text', text: CANCELED_TURN_NOTE }] })
    await this.markPreview(state.pending, CHAT_MESSAGES.rejected)
    this.runState.finishRun()
    await this.send(this.chatId()!, CHAT_MESSAGES.canceled)
    return true
  }

  // Leaves a pending preview without buttons (used when the conversation is dropped).
  private async closePending(status: string): Promise<void> {
    const { pending } = this.runState.get()
    if (pending) await this.markPreview(pending, status)
  }

  private async markPreview(pending: PendingApproval, status: string): Promise<void> {
    const chatId = this.chatId()
    if (chatId === null || pending.messageId === null) return
    const chunks = splitMessage(pending.writes.map((w) => w.preview).join('\n\n'), PREVIEW_CHUNK)
    await this.api
      .editMessageText(chatId, pending.messageId, `${chunks[chunks.length - 1]}\n\n${status}`, { parse_mode: 'HTML' })
      .catch((error) => console.warn('Could not update preview', error))
  }

  // ── Agent ────────────────────────────────────────────────────────────────────

  private toolContext(): ToolContext {
    return { spreadsheet: this.spreadsheet, cards: this.bank.cards, memories: this.memories, files: this.files, writes: this.writes, now: new Date() }
  }

  private stepInput(conversation: Conversation): Omit<StepInput, 'toolContext'> {
    return {
      client: this.claude,
      model: this.model(),
      effort: (this.env.CLAUDE_EFFORT as Effort | undefined) ?? DEFAULT_EFFORT,
      system: conversation.systemPrompt,
      messages: this.conversations.messages(conversation),
      tools: TOOLS
    }
  }

  private async agentStep(state: RunState): Promise<void> {
    const conversation = state.conversationId ? this.conversations.get(state.conversationId) : null
    const chatId = this.chatId()
    if (!conversation || chatId === null) {
      this.runState.finishRun()
      return
    }

    if (this.consumeCancelRequest()) {
      // Closing the turn in the history keeps the model from resuming the canceled
      // request when the next message arrives.
      this.conversations.append(conversation.id, { role: 'assistant', content: [{ type: 'text', text: CANCELED_TURN_NOTE }] })
      this.runState.finishRun()
      await this.send(chatId, CHAT_MESSAGES.canceled)
      return
    }

    // The history always ends with a user message here (the request or tool
    // results), so stopping leaves it valid for the next turn.
    if (state.step >= MAX_STEPS_PER_TURN) {
      this.runState.finishRun()
      await this.send(chatId, CHAT_MESSAGES.tooManySteps)
      return
    }

    await this.api.sendChatAction(chatId, 'typing').catch(() => {})

    // A step that died between saving the model's reply and its tool results left
    // calls unanswered; close them so the history is valid again.
    const dangling = unresolvedToolUses(this.conversations.messages(conversation))
    if (dangling.length > 0) {
      this.conversations.append(conversation.id, { role: 'user', content: interruptedResults(dangling) })
    }

    const input = { ...this.stepInput(conversation), toolContext: this.toolContext() }
    let result
    try {
      result = await runStep(input)
    } catch (error) {
      console.error('Agent step failed', error)
      if (error instanceof Anthropic.BadRequestError && (await this.restartConversation(chatId, input.messages))) return
      this.runState.finishRun()
      await this.send(chatId, error instanceof Anthropic.APIError ? CHAT_MESSAGES.apiError : CHAT_MESSAGES.internalError)
      return
    }

    // From here on the reply is saved, so nothing may fail before its tool calls get
    // results (or a pending approval is recorded).
    this.conversations.append(conversation.id, result.assistant)
    await this.recordUsage(chatId, input.model, result.usage).catch((error) => console.error('Usage tracking failed', error))

    switch (result.outcome.kind) {
      case 'continue':
        this.conversations.append(conversation.id, result.outcome.toolResults)
        this.runState.nextStep(state.step)
        return

      case 'approval': {
        const { results, writes } = result.outcome
        const token = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
        this.runState.awaitApproval({ token, messageId: null, results, writes })

        try {
          const messageId = await this.sendPreview(chatId, writes.map((w) => w.preview).join('\n\n'), token)
          this.runState.awaitApproval({ token, messageId, results, writes })
        } catch (error) {
          // Without a preview the user can't approve: report it to the model instead.
          console.error('Preview failed', error)
          const reason = error instanceof GrammyError ? error.description : String(error)
          const failed = writes.map((w) =>
            toolResult(w.toolUseId, `Não consegui mostrar a prévia ao usuário (${reason}). Nada foi gravado. Tente de novo em partes menores.`, true)
          )
          this.conversations.append(conversation.id, { role: 'user', content: [...results, ...failed] })
          this.runState.nextStep(state.step)
        }
        return
      }

      case 'reply':
        this.runState.finishRun()
        await this.sendMarkdown(chatId, result.outcome.text || CHAT_MESSAGES.emptyReply)
        if (result.contextTokens > Number(this.env.COMPACT_AT_TOKENS ?? COMPACT_AT_TOKENS)) await this.compactConversation(conversation)
        return

      case 'refusal':
        this.runState.finishRun()
        await this.send(chatId, CHAT_MESSAGES.refusal)
        return
    }
  }

  // Sends a preview in as many messages as needed; the buttons go on the last one,
  // whose id is returned.
  private async sendPreview(chatId: number, preview: string, token: string): Promise<number> {
    const chunks = splitMessage(preview, PREVIEW_CHUNK)
    let messageId = 0
    for (const [i, chunk] of chunks.entries()) {
      const last = i === chunks.length - 1
      const sent = await this.api.sendMessage(chatId, chunk, { parse_mode: 'HTML', ...(last ? { reply_markup: approvalKeyboard(token) } : {}) })
      messageId = sent.message_id
    }
    return messageId
  }

  // Last resort when the API rejects the history: start a new conversation with the
  // user's last message and keep going. Returns false when there is nothing to retry
  // (or the history was already fresh), so the caller reports the error instead.
  private async restartConversation(chatId: number, messages: MessageParam[]): Promise<boolean> {
    const input = lastUserInput(messages)
    if (input.length === 0 || messages.length <= 1) return false

    const conversation = this.startConversation()
    this.conversations.append(conversation.id, { role: 'user', content: input })
    this.runState.startRun()
    await this.send(chatId, CHAT_MESSAGES.historyReset).catch(() => {})
    return true
  }

  // Replaces a long history with a signed summary. Best effort: on any failure the
  // conversation simply continues uncompacted.
  private async compactConversation(conversation: Conversation): Promise<void> {
    try {
      const input = this.stepInput(conversation)
      const { summary, usage } = await compact(input)
      await this.recordUsage(this.chatId()!, input.model, usage)
      if (summary) this.conversations.setSummary(conversation.id, summary)
    } catch (error) {
      console.error('Compaction failed', error)
    }
  }

  // /cancelar sent while a turn runs waits in the inbox; it is honored before the
  // next step.
  private consumeCancelRequest(): boolean {
    const cancel = this.inbox.pending().find(({ update }) => update.message?.text?.trim().toLowerCase() === '/cancelar')
    if (!cancel) return false
    this.inbox.markProcessed(cancel.updateId)
    return true
  }

  private async currentConversation(chatId: number): Promise<Conversation> {
    const { conversationId } = this.runState.get()
    const current = conversationId ? this.conversations.get(conversationId) : null

    if (current?.toolsHash === this.fingerprint()) return current

    // A conversation started with another tool set cannot continue.
    const conversation = this.startConversation()
    if (current) await this.send(chatId, CHAT_MESSAGES.conversationReset)
    return conversation
  }

  // Tools, prompt version and the tab sandbox all shape the frozen prompt; a change in
  // any of them starts a new conversation.
  private fingerprint(): string {
    return `${PROMPT_FINGERPRINT}-${this.spreadsheet.prefix.trim() || 'all'}`
  }

  private startConversation(): Conversation {
    const systemPrompt = buildSystemPrompt({
      userName: this.settings.get('user_name') ?? '',
      tabPrefix: this.spreadsheet.prefix,
      memories: this.memories.list()
    })
    const conversation = this.conversations.create(systemPrompt, this.fingerprint())
    this.runState.startConversation(conversation.id)
    return conversation
  }

  // ── Proactive jobs ───────────────────────────────────────────────────────────

  private async processNextJob(): Promise<void> {
    const job = this.jobs.next()
    if (!job) return
    this.jobs.markProcessed(job.id)

    if (job.kind === 'maintenance') {
      await this.maintenance()
      return
    }
    if (job.kind === 'bank_fetch' || job.kind === 'bank_process') {
      try {
        await (job.kind === 'bank_fetch' ? this.bank.fetch() : this.bank.process())
      } catch (error) {
        console.error('Card import failed', job.kind, error)
      }
      return
    }

    // In a private chat the chat id is the user id, so jobs work before any message.
    const chatId = this.chatId() ?? Number(this.env.ALLOWED_USER_ID)
    if (!chatId) return
    if (this.chatId() === null) this.settings.set('chat_id', String(chatId))

    try {
      const action = await proactiveAction(job.kind as ProactiveKind, this.toolContext())
      if (action.kind === 'message') {
        await this.send(chatId, action.html)
        return
      }

      const conversation = await this.currentConversation(chatId)
      this.conversations.append(conversation.id, {
        role: 'user',
        content: [{ type: 'text', text: `[${messageTimestamp(new Date())}] (mensagem automática) ${action.prompt}` }]
      })
      this.runState.startRun()
    } catch (error) {
      console.error('Proactive job failed', job.kind, error)
    }
  }

  private async maintenance(): Promise<void> {
    try {
      const { conversationId } = this.runState.get()
      const more = await runMaintenance({
        inbox: this.inbox,
        files: this.files,
        jobs: this.jobs,
        writes: this.writes,
        conversations: this.conversations,
        uploads: this.uploads,
        current: conversationId ? this.conversations.get(conversationId) : null,
        deleteFile: (fileId) => deleteFile(this.claude, fileId),
        now: Date.now()
      })
      if (more && !this.jobs.hasPending('maintenance')) this.jobs.add('maintenance')
    } catch (error) {
      console.error('Maintenance failed', error)
    }
  }

  // ── Cost ─────────────────────────────────────────────────────────────────────

  private model(): string {
    return this.settings.get('model') ?? this.env.CLAUDE_MODEL ?? DEFAULT_MODEL
  }

  private budget(): number {
    return Number(this.settings.get('budget_usd') ?? this.env.MONTHLY_BUDGET_USD ?? DEFAULT_MONTHLY_BUDGET_USD)
  }

  private raisedBudget(): number {
    return Math.ceil(this.budget() * 1.5)
  }

  private async recordUsage(chatId: number, model: string, usage: Usage): Promise<void> {
    const month = monthKey(new Date())
    const total = this.usage.add(month, usageDelta(model, usage))
    const budget = this.budget()

    if (!total.alertSent && total.costUsd >= budget * BUDGET_ALERT_RATIO) {
      this.usage.markAlertSent(month)
      await this.send(
        chatId,
        CHAT_MESSAGES.budgetAlert(formatUsd(total.costUsd), formatUsd(budget), Math.round((total.costUsd / budget) * 100)),
        budgetKeyboard(formatUsd(this.raisedBudget()), MODEL_NAMES[BUDGET_MODEL])
      )
    }
  }

  private usageReport(): string {
    const now = new Date()
    const total = this.usage.get(monthKey(now))
    const budget = this.budget()
    const model = this.model()
    return CHAT_MESSAGES.usage({
      month: monthLabel(now),
      spent: formatUsd(total.costUsd),
      budget: formatUsd(budget),
      percent: Math.round((total.costUsd / budget) * 100),
      requests: total.requests,
      model: MODEL_NAMES[model] ?? model
    })
  }

  // ── Telegram ─────────────────────────────────────────────────────────────────

  // Remembered from the first update so work run from the alarm knows where to reply.
  private chatId(): number | null {
    const stored = this.settings.get('chat_id')
    return stored ? Number(stored) : null
  }

  private async send(chatId: number, html: string, replyMarkup?: InlineKeyboardMarkup): Promise<void> {
    await this.api.sendMessage(chatId, html, { parse_mode: 'HTML', reply_markup: replyMarkup })
  }

  // Model output may still produce HTML Telegram rejects; fall back to plain text.
  private async sendMarkdown(chatId: number, markdown: string): Promise<void> {
    for (const chunk of splitMessage(markdownToTelegramHtml(markdown))) {
      try {
        await this.api.sendMessage(chatId, chunk, { parse_mode: 'HTML' })
      } catch (error) {
        if (!(error instanceof GrammyError) || error.error_code !== 400) throw error
        console.warn('HTML rejected by Telegram, sending plain text', error.description)
        await this.api.sendMessage(chatId, chunk.replace(/<[^>]+>/g, ''))
      }
    }
  }
}

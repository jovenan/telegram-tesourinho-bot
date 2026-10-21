// Talk to the local dev bot as if from Telegram, and print what it replies.
// Needs `bun run dev:telegram` and `bun run dev:worker` running.
//
//   bun scripts/dev/chat.ts "quanto gastei com mercado?"
//   bun scripts/dev/chat.ts --photo recibo.jpg "legenda opcional"   (file in scripts/dev/fixtures)
//   bun scripts/dev/chat.ts --doc extrato.csv
//   bun scripts/dev/chat.ts --click approve:3      (callback_data of a button)
//   bun scripts/dev/chat.ts --cron "0 13 * * sat"  (runs the scheduled handler)
//   bun scripts/dev/chat.ts --state                (dumps the chat's Durable Object tables)
//   bun scripts/dev/chat.ts --new-chat             (next messages go to a fresh chat/DO)
import { existsSync, readFileSync, writeFileSync } from 'fs'

const WORKER = process.env.DEV_WORKER_URL ?? 'http://localhost:8787'
const TELEGRAM = process.env.FAKE_TELEGRAM_URL ?? 'http://localhost:8798'
const SECRET = process.env.DEV_WEBHOOK_SECRET ?? 'dev-secret'
const USER_ID = 1
const STATE_FILE = new URL('./.chat-state.json', import.meta.url)
const TIMEOUT_MS = 180_000
const QUIET_MS = 1_500

type State = { updateId: number; chatId: number; lastCallId: number; lastMessageId: number }
type Call = { id: number; method: string; params: Record<string, any>; result: any }

const state: State = existsSync(STATE_FILE)
  ? JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  : { updateId: 1, chatId: 100, lastCallId: 0, lastMessageId: 0 }

const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))

const from = { id: USER_ID, is_bot: false, first_name: 'Dev' }
const chat = () => ({ id: state.chatId, type: 'private' })
const date = () => Math.floor(Date.now() / 1000)

async function postUpdate(update: Record<string, unknown>): Promise<void> {
  // Clock-based ids never collide, even with several CLIs running at once.
  state.updateId = Math.max(state.updateId + 1, Date.now())
  const response = await fetch(`${WORKER}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': SECRET },
    body: JSON.stringify({ update_id: state.updateId, ...update })
  })
  saveState()
  if (!response.ok) throw new Error(`webhook ${response.status}: ${await response.text()}`)
}

function message(extra: Record<string, unknown>) {
  return { message: { message_id: state.updateId, date: date(), chat: chat(), from, ...extra } }
}

async function explorerQuery(sql: string): Promise<{ columns: string[]; rows: unknown[][] }> {
  const api = `${WORKER}/cdn-cgi/local/explorer/api/workers/durable_objects/namespaces`
  const namespaces = (await (await fetch(api)).json()) as { result: Array<{ id: string; class: string }> }
  const namespace = namespaces.result.find((ns) => ns.class === 'ChatDO')
  if (!namespace) throw new Error('ChatDO namespace not found; is the dev worker running?')

  const response = await fetch(`${api}/${namespace.id}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ durable_object_name: String(state.chatId), queries: [{ sql }] })
  })
  const data = (await response.json()) as { result?: Array<{ columns: string[]; rows: unknown[][] }> }
  return data.result?.[0] ?? { columns: [], rows: [] }
}

async function isIdle(): Promise<boolean> {
  try {
    const pending = await explorerQuery('SELECT COUNT(*) FROM inbox WHERE processed_at IS NULL')
    const run = await explorerQuery('SELECT status FROM run_state WHERE id = 1')
    return pending.rows[0]?.[0] === 0 && run.rows[0]?.[0] !== 'running'
  } catch {
    return false
  }
}

function printCall(call: Call): void {
  const { method, params } = call
  if (method === 'sendChatAction') return

  if (method === 'sendMessage' || method === 'editMessageText' || method === 'sendRichMessage') {
    const label = method === 'editMessageText' ? `✏️  (edita #${params.message_id})` : '🤖'
    console.log(`${label} ${params.text ?? JSON.stringify(params.rich_message ?? params)}`)
  } else if (method === 'editMessageReplyMarkup') {
    console.log(`✏️  (botões de #${params.message_id} atualizados)`)
  } else if (method === 'answerCallbackQuery') {
    if (params.text) console.log(`💬 ${params.text}`)
    return
  } else {
    console.log(`· ${method} ${JSON.stringify(params).slice(0, 200)}`)
  }

  const keyboard = params.reply_markup?.inline_keyboard as Array<Array<{ text: string; callback_data?: string }>> | undefined
  if (keyboard?.length) {
    console.log('   ' + keyboard.flat().map((b) => `[${b.text} → ${b.callback_data}]`).join(' '))
  }
}

async function drainCalls(): Promise<number> {
  const calls = (await (await fetch(`${TELEGRAM}/_calls?since=${state.lastCallId}`)).json()) as Call[]
  for (const call of calls) {
    printCall(call)
    state.lastCallId = call.id
  }
  saveState()
  return calls.length
}

// The bot marks the run idle right before sending its final reply, so "idle" must be
// seen twice in a row (and the calls drained once more) before the turn counts as done.
async function waitForReplies(): Promise<void> {
  const started = Date.now()
  let lastActivity = Date.now()
  let idleChecks = 0

  while (Date.now() - started < TIMEOUT_MS) {
    if ((await drainCalls()) > 0) {
      lastActivity = Date.now()
      idleChecks = 0
    }

    if (Date.now() - lastActivity > QUIET_MS && (await isIdle())) {
      idleChecks++
      if (idleChecks >= 2) {
        await drainCalls()
        return
      }
    } else {
      idleChecks = 0
    }
    await Bun.sleep(500)
  }

  console.log(`⏱️  sem conclusão em ${TIMEOUT_MS / 1000}s`)
}

async function printState(): Promise<void> {
  for (const table of ['run_state', 'conversations', 'inbox']) {
    const { columns, rows } = await explorerQuery(`SELECT * FROM ${table} ORDER BY rowid DESC LIMIT 10`)
    console.log(`\n# ${table}`)
    console.log(columns.join(' | '))
    for (const row of rows) console.log(row.map((v) => String(v).slice(0, 80)).join(' | '))
  }
}

const [flag, ...rest] = process.argv.slice(2)

switch (flag) {
  case '--new-chat':
    state.chatId++
    saveState()
    console.log(`chat ${state.chatId}`)
    break
  case '--state':
    await printState()
    break
  case '--photo':
    await postUpdate(message({ photo: [{ file_id: rest[0], file_unique_id: rest[0], width: 1000, height: 1000 }], caption: rest[1] }))
    await waitForReplies()
    break
  case '--doc':
    await postUpdate(message({ document: { file_id: rest[0], file_unique_id: rest[0], file_name: rest[0] }, caption: rest[1] }))
    await waitForReplies()
    break
  case '--click': {
    const calls = (await (await fetch(`${TELEGRAM}/_calls`)).json()) as Call[]
    const source = calls.findLast((call) =>
      JSON.stringify(call.params.reply_markup ?? '').includes(JSON.stringify(rest[0]))
    )
    await postUpdate({
      callback_query: {
        id: String(state.updateId),
        from,
        chat_instance: 'dev',
        data: rest[0],
        message: { message_id: Number(source?.result?.message_id ?? source?.params.message_id ?? 0), date: date(), chat: chat(), text: source?.params.text }
      }
    })
    await waitForReplies()
    break
  }
  case '--cron': {
    const response = await fetch(`${WORKER}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent(rest[0])}`)
    console.log(`cron ${rest[0]} → ${response.status}`)
    await waitForReplies()
    break
  }
  default: {
    const text = [flag, ...rest].join(' ').trim()
    if (!text) throw new Error('Mensagem vazia')
    await postUpdate(message({ text }))
    await waitForReplies()
  }
}

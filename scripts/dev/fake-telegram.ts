// Minimal fake of the Telegram Bot API for local development. The dev Worker points
// its API root here, so nothing reaches the real Telegram. Every call is recorded
// and exposed at GET /_calls so the chat CLI can show what the bot "sent".
//
// Usage: bun scripts/dev/fake-telegram.ts   (listens on :8798)
import { existsSync, readFileSync } from 'fs'

const PORT = Number(process.env.FAKE_TELEGRAM_PORT ?? 8798)
const FIXTURES = new URL('./fixtures/', import.meta.url)

type Call = { id: number; at: number; method: string; params: Record<string, any>; result: unknown }

const calls: Call[] = []
// Ids start from the clock so they keep growing across restarts (the chat CLI
// remembers the last id it printed).
let nextCallId = Date.now()
let nextMessageId = 1000

function respond(method: string, params: Record<string, any>): unknown {
  const chat = { id: Number(params.chat_id ?? 1), type: 'private' }
  const date = Math.floor(Date.now() / 1000)

  switch (method) {
    case 'sendMessage':
    case 'sendRichMessage':
      return { message_id: nextMessageId++, chat, date, text: params.text, reply_markup: params.reply_markup }
    case 'editMessageText':
      return { message_id: Number(params.message_id), chat, date, text: params.text, reply_markup: params.reply_markup }
    case 'getFile':
      // file_id doubles as the fixture path, e.g. "recibo.jpg".
      return { file_id: params.file_id, file_unique_id: params.file_id, file_path: params.file_id }
    case 'getMe':
      return { id: 1, is_bot: true, first_name: 'DevBot', username: 'dev_bot' }
    default:
      return true
  }
}

async function readParams(request: Request): Promise<Record<string, any>> {
  const type = request.headers.get('content-type') ?? ''
  if (type.includes('application/json')) return (await request.json()) as Record<string, any>
  if (type.includes('form')) return Object.fromEntries((await request.formData()).entries())
  return Object.fromEntries(new URL(request.url).searchParams.entries())
}

Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === '/_calls') {
      const since = Number(url.searchParams.get('since') ?? 0)
      return Response.json(calls.filter((call) => call.id > since))
    }

    const file = url.pathname.match(/^\/file\/bot[^/]+\/(.+)$/)
    if (file) {
      const path = new URL(decodeURIComponent(file[1]), FIXTURES)
      return existsSync(path) ? new Response(readFileSync(path)) : new Response('not found', { status: 404 })
    }

    const method = url.pathname.match(/^\/bot[^/]+\/(\w+)$/)?.[1]
    if (!method) return new Response('not found', { status: 404 })

    const params = await readParams(request)
    const result = respond(method, params)
    calls.push({ id: ++nextCallId, at: Date.now(), method, params, result })
    return Response.json({ ok: true, result })
  }
})

console.log(`fake Telegram API on http://localhost:${PORT}`)

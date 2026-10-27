import { Hono } from 'hono'
import type { Update } from 'grammy/types'
import { CRON_JOBS } from './proactive'
import type { Env } from './types'

export { ChatDO } from './chat-do'

const app = new Hono<{ Bindings: Env }>()

app.get('/', (c) => {
  return c.text('Telegram Bot is running!')
})

app.post('/webhook', async (c) => {
  const env = c.env
  const secretToken = c.req.header('X-Telegram-Bot-Api-Secret-Token')

  // Fail closed: without the secret configured, nothing is accepted.
  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    console.error('TELEGRAM_WEBHOOK_SECRET is not set; refusing webhook updates')
    return c.json({ error: 'Unauthorized' }, 401)
  }
  if (secretToken !== env.TELEGRAM_WEBHOOK_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const update: Update = await c.req.json()
  const userId = update.message?.from?.id ?? update.callback_query?.from.id
  const chat = update.message?.chat ?? update.callback_query?.message?.chat

  // Fail closed: without ALLOWED_USER_ID nobody can use the bot. Only the owner's
  // private chat is served; anything else gets a 200 (so Telegram does not redeliver)
  // and no reply.
  if (userId === undefined || !chat || chat.type !== 'private' || String(userId) !== env.ALLOWED_USER_ID) {
    return c.json({ ok: true })
  }

  const stub = env.CHAT.get(env.CHAT.idFromName(String(chat.id)))
  await stub.enqueue(update)

  return c.json({ ok: true })
})

// Staging-only inspection of the owner's conversation, to debug the agent's behavior.
// Exists only when the DEBUG_TOKEN secret is set (never in production).
app.get('/debug/messages', async (c) => {
  const env = c.env
  if (!env.DEBUG_TOKEN || c.req.header('Authorization') !== `Bearer ${env.DEBUG_TOKEN}`) {
    return c.json({ error: 'Not found' }, 404)
  }
  const limit = Math.min(Number(c.req.query('limit') ?? 60), 300)
  const chat = env.CHAT.get(env.CHAT.idFromName(env.ALLOWED_USER_ID))
  return c.json(await chat.debugMessages(limit))
})

export default {
  fetch: app.fetch,

  // Proactive messages go to the owner's private chat, whose id is the user id.
  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    const kind = CRON_JOBS[event.cron.toLowerCase()]
    if (!kind || !env.ALLOWED_USER_ID) return
    await env.CHAT.get(env.CHAT.idFromName(env.ALLOWED_USER_ID)).schedule(kind)
  }
} satisfies ExportedHandler<Env>

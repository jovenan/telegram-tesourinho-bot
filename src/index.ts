import { Hono } from 'hono'
import { handleMessage, handlePhotoMessage, handleCallbackQuery } from './bot'
import type { Env, TelegramUpdate } from './types'

const app = new Hono<{ Bindings: Env }>()

function getAllowedUserIds(env: Env): Set<number> {
  if (!env.TELEGRAM_ALLOWED_USER_IDS) {
    return new Set()
  }

  const ids = env.TELEGRAM_ALLOWED_USER_IDS
    .split(',')
    .map((id) => Number(id.trim()))
    .filter((id) => Number.isFinite(id))

  return new Set(ids)
}

function isAllowedUser(env: Env, userId: number): boolean {
  const allowedUserIds = getAllowedUserIds(env)

  if (allowedUserIds.size === 0) {
    console.error('TELEGRAM_ALLOWED_USER_IDS is not configured. Blocking all users.')
    return false
  }

  return allowedUserIds.has(userId)
}

app.get('/', (c) => {
  return c.text('Telegram Bot is running!')
})

app.post('/webhook', async (c) => {
  const env = c.env
  const secretToken = c.req.header('X-Telegram-Bot-Api-Secret-Token')

  if (env.TELEGRAM_WEBHOOK_SECRET && secretToken !== env.TELEGRAM_WEBHOOK_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const update: TelegramUpdate = await c.req.json()

  if (update.callback_query) {
    const { callback_query } = update
    const userId = callback_query.from.id

    if (!isAllowedUser(env, userId)) {
      console.log('Unauthorized callback ignored:', JSON.stringify({
        userId,
        firstName: callback_query.from.first_name,
        data: callback_query.data
      }))
      return c.json({ ok: true })
    }

    const chatId = callback_query.message?.chat.id
    const messageId = callback_query.message?.message_id
    const data = callback_query.data

    if (chatId && messageId && data) {
      await handleCallbackQuery(env, callback_query.id, chatId, messageId, userId, data)
    }
  }
  else if (update.message) {
    const { message } = update
    const chatId = message.chat.id
    const userId = message.from.id
    const firstName = message.from.first_name

    if (!isAllowedUser(env, userId)) {
      console.log('Unauthorized message ignored:', JSON.stringify({
        chatId,
        userId,
        firstName,
        hasPhoto: Boolean(message.photo?.length),
        text: message.text,
        caption: message.caption
      }))
      return c.json({ ok: true })
    }

    const logContext = {
      chatId,
      userId,
      firstName,
      hasPhoto: Boolean(message.photo?.length),
      text: message.text,
      caption: message.caption
    }

    console.log('Telegram message received:', JSON.stringify(logContext))

    if (message.photo && message.photo.length > 0) {
      await handlePhotoMessage(env, chatId, userId, firstName, message.date, message.photo, message.caption)
    }
    else if (message.text) {
      await handleMessage(env, chatId, userId, message.text, firstName)
    }
  }

  return c.json({ ok: true })
})

export default app

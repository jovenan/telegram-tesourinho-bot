import { Hono } from 'hono'
import { handleMessage } from './bot'
import type { TelegramUpdate } from './types'

const app = new Hono()

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''

app.get('/', (c) => {
  return c.text('Telegram Bot is running!')
})

app.post('/webhook', async (c) => {
  const update: TelegramUpdate = await c.req.json()

  if (update.message?.text) {
    const { message } = update
    const chatId = message.chat.id
    const userId = message.from.id
    const text = message.text
    const firstName = message.from.first_name

    console.log(`[${firstName}]: ${text}`)

    await handleMessage(chatId, userId, text ?? '', firstName)
  }

  return c.json({ ok: true })
})

app.get('/set-webhook', async (c) => {
  const webhookUrl = c.req.query('url')

  if (!webhookUrl) {
    return c.json({ error: 'Parameter "url" is required' }, 400)
  }

  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `${webhookUrl}/webhook` })
    }
  )

  const result = await response.json()
  return c.json(result)
})

export default app

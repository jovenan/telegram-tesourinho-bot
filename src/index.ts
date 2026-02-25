import { Hono } from 'hono'
import { handleMessage, handlePhotoMessage } from './bot'
import { BOT_TOKEN } from './config'
import type { TelegramUpdate } from './types'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Telegram Bot is running!')
})

app.post('/webhook', async (c) => {
  const update: TelegramUpdate = await c.req.json()

  if (update.message) {
    const { message } = update
    const chatId = message.chat.id
    const userId = message.from.id
    const firstName = message.from.first_name

    if (message.photo && message.photo.length > 0) {
      console.log(`[${firstName}]: 📷 Enviou uma foto`)
      await handlePhotoMessage(chatId, userId, message.photo, message.caption, firstName)
    }
    else if (message.text) {
      console.log(`[${firstName}]: ${message.text}`)
      await handleMessage(chatId, userId, message.text, firstName)
    }
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

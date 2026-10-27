// Points the Telegram bot at the deployed Worker and registers the command menu.
//
// Usage:
//   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
//   WEBHOOK_URL=https://telegram-api-bot.<subdomain>.workers.dev/webhook \
//   bun scripts/setup-telegram.ts
import { Api } from 'grammy'

const { TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, WEBHOOK_URL } = process.env
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET || !WEBHOOK_URL) {
  throw new Error('Defina TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET e WEBHOOK_URL.')
}

const api = new Api(TELEGRAM_BOT_TOKEN)

await api.setWebhook(WEBHOOK_URL, {
  secret_token: TELEGRAM_WEBHOOK_SECRET,
  allowed_updates: ['message', 'callback_query'],
  // The new bot has its own queue; old updates were meant for the previous flow.
  drop_pending_updates: true
})

await api.setMyCommands([
  { command: 'novo', description: 'Começar uma conversa nova' },
  { command: 'memoria', description: 'Preferências guardadas' },
  { command: 'custo', description: 'Gasto com a IA neste mês' },
  { command: 'sync', description: 'Buscar agora as compras do cartão' },
  { command: 'banco', description: 'Situação da importação do cartão' },
  { command: 'cancelar', description: 'Interromper o que estiver em andamento' },
  { command: 'ajuda', description: 'Comandos e dicas' }
])

const info = await api.getWebhookInfo()
console.log(`Webhook: ${info.url} (pendentes: ${info.pending_update_count})`)
console.log('Comandos registrados.')

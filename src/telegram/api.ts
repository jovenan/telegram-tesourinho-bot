import { Api } from 'grammy'
import { autoRetry } from '@grammyjs/auto-retry'

// apiRoot is overridden in development to point at scripts/dev/fake-telegram.ts.
export function createTelegramApi(token: string, apiRoot?: string): Api {
  const api = new Api(token, apiRoot ? { apiRoot } : undefined)
  api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 30 }))
  return api
}

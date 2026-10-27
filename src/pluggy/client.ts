import type { PluggyAccount, PluggyBill, PluggyItem, PluggyPage, PluggyTransaction } from './types'

const API_ROOT = 'https://api.pluggy.ai'
// API keys last 2 hours; renewed a bit earlier.
const API_KEY_TTL_MS = 100 * 60_000
// Safety net for cursor loops (500 transactions per page).
const MAX_PAGES = 10

export interface PluggyCredentials {
  clientId: string
  clientSecret: string
}

export class PluggyError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'PluggyError'
  }
}

// Read-only client for the Meu Pluggy API: items, accounts, bills and transactions.
export class PluggyClient {
  private apiKey: { value: string; at: number } | null = null

  constructor(
    private readonly credentials: PluggyCredentials,
    private readonly apiRoot = API_ROOT
  ) {}

  item(itemId: string): Promise<PluggyItem> {
    return this.get<PluggyItem>(`/items/${encodeURIComponent(itemId)}`)
  }

  async accounts(itemId: string): Promise<PluggyAccount[]> {
    return (await this.get<PluggyPage<PluggyAccount>>(`/accounts?itemId=${encodeURIComponent(itemId)}`)).results
  }

  // Bills of a credit card account (closed ones), to know which month each purchase
  // is due in.
  async bills(accountId: string): Promise<PluggyBill[]> {
    return (await this.get<PluggyPage<PluggyBill>>(`/bills?accountId=${encodeURIComponent(accountId)}`)).results
  }

  // Transactions dated on or after `dateFrom` (yyyy-mm-dd), following the cursor.
  async transactions(accountId: string, dateFrom: string): Promise<PluggyTransaction[]> {
    const all: PluggyTransaction[] = []
    let query: string | null = `?accountId=${encodeURIComponent(accountId)}&dateFrom=${dateFrom}`
    for (let page = 0; query && page < MAX_PAGES; page++) {
      const data: PluggyPage<PluggyTransaction> = await this.get(`/v2/transactions${query}`)
      all.push(...data.results)
      query = data.next ?? null
    }
    return all
  }

  private async key(): Promise<string> {
    if (this.apiKey && Date.now() - this.apiKey.at < API_KEY_TTL_MS) return this.apiKey.value
    const response = await fetch(`${this.apiRoot}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.credentials)
    })
    if (!response.ok) throw new PluggyError(response.status, `Pluggy auth failed: ${response.status}`)
    const { apiKey } = (await response.json()) as { apiKey: string }
    this.apiKey = { value: apiKey, at: Date.now() }
    return apiKey
  }

  private async get<T>(path: string, retried = false): Promise<T> {
    const response = await fetch(`${this.apiRoot}${path}`, { headers: { 'X-API-KEY': await this.key() } })
    // An expired key: get a new one once.
    if ((response.status === 401 || response.status === 403) && !retried && this.apiKey) {
      this.apiKey = null
      return this.get(path, true)
    }
    if (!response.ok) throw new PluggyError(response.status, `Pluggy GET ${path.split('?')[0]} failed: ${response.status}`)
    return (await response.json()) as T
  }
}

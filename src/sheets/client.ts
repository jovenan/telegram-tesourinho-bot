import { getAccessToken, type ServiceAccount } from './auth'
import { parseSheetTitle, sheetRange } from './a1'

export interface SheetInfo {
  sheetId: number
  title: string
  index: number
  hidden: boolean
  rowCount: number
  columnCount: number
}

export interface SheetsClientOptions {
  account: ServiceAccount
  spreadsheetId: string
  // When set, every write must target a sheet whose title starts with this prefix.
  // Used in development so the real tabs can never be modified.
  writePrefix?: string
  // When set, every read and write must target a visible sheet whose title matches.
  // The Worker passes the monthly-tab pattern so no other tab is ever touched, even
  // if a tool forgets to check.
  tabAccess?: RegExp
}

export type CellValue = string | number | boolean
export type BatchUpdateRequest = Record<string, unknown>

export class SheetsWriteBlockedError extends Error {
  constructor(title: string, prefix: string) {
    super(`Write blocked: sheet "${title}" does not start with "${prefix}"`)
    this.name = 'SheetsWriteBlockedError'
  }
}

export class SheetsAccessBlockedError extends Error {
  constructor(title: string) {
    super(`Access blocked: sheet "${title}" is hidden or is not a monthly tab`)
    this.name = 'SheetsAccessBlockedError'
  }
}

const API_ROOT = 'https://sheets.googleapis.com/v4/spreadsheets'

// The tab list is read by almost every tool; caching it briefly keeps each agent
// step well under the Workers subrequest limit. Any structural change clears it.
const SHEETS_CACHE_MS = 30_000

export class SheetsClient {
  private sheetsCache: { at: number; sheets: Promise<SheetInfo[]> } | null = null

  constructor(private readonly options: SheetsClientOptions) {}

  listSheets(): Promise<SheetInfo[]> {
    if (!this.sheetsCache || Date.now() - this.sheetsCache.at > SHEETS_CACHE_MS) {
      const sheets = this.fetchSheets()
      sheets.catch(() => (this.sheetsCache = null))
      this.sheetsCache = { at: Date.now(), sheets }
    }
    return this.sheetsCache.sheets
  }

  private async fetchSheets(): Promise<SheetInfo[]> {
    const data = await this.request<{ sheets?: Array<{ properties: any }> }>(
      'GET',
      '?fields=sheets.properties(sheetId,title,index,hidden,gridProperties(rowCount,columnCount))'
    )

    return (data.sheets ?? []).map(({ properties }) => ({
      sheetId: properties.sheetId,
      title: properties.title,
      index: properties.index,
      hidden: properties.hidden ?? false,
      rowCount: properties.gridProperties?.rowCount ?? 0,
      columnCount: properties.gridProperties?.columnCount ?? 0
    }))
  }

  async getValues(range: string, render: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA' = 'FORMATTED_VALUE'): Promise<CellValue[][]> {
    await this.assertAccessible([parseSheetTitle(range)])
    const data = await this.request<{ values?: CellValue[][] }>(
      'GET',
      `/values/${encodeURIComponent(range)}?valueRenderOption=${render}`
    )
    return data.values ?? []
  }

  async getDataValidation(range: string): Promise<Array<{ row: number; column: number; rule: unknown }>> {
    await this.assertAccessible([parseSheetTitle(range)])
    const data = await this.request<{ sheets?: Array<{ data?: Array<{ startRow?: number; startColumn?: number; rowData?: Array<{ values?: Array<{ dataValidation?: unknown }> }> }> }> }>(
      'GET',
      `?ranges=${encodeURIComponent(range)}&fields=sheets(data(startRow,startColumn,rowData.values.dataValidation))`
    )

    const rules: Array<{ row: number; column: number; rule: unknown }> = []
    for (const sheet of data.sheets ?? []) {
      for (const grid of sheet.data ?? []) {
        grid.rowData?.forEach((row, i) =>
          row.values?.forEach((cell, j) => {
            if (cell.dataValidation) {
              rules.push({ row: (grid.startRow ?? 0) + i, column: (grid.startColumn ?? 0) + j, rule: cell.dataValidation })
            }
          })
        )
      }
    }
    return rules
  }

  async updateValues(range: string, values: CellValue[][]): Promise<void> {
    this.assertWritable(parseSheetTitle(range))
    await this.assertAccessible([parseSheetTitle(range)])
    await this.request('PUT', `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, { values })
  }

  async clearValues(range: string): Promise<void> {
    this.assertWritable(parseSheetTitle(range))
    await this.assertAccessible([parseSheetTitle(range)])
    await this.request('POST', `/values/${encodeURIComponent(range)}:clear`, {})
  }

  async batchUpdate(requests: BatchUpdateRequest[]): Promise<{ replies?: any[] }> {
    if (this.options.writePrefix || this.options.tabAccess) {
      const titles = new Map((await this.listSheets()).map((sheet) => [sheet.sheetId, sheet.title]))
      const targets = requests.flatMap((request) => targetTitles(request, titles))
      for (const title of targets) this.assertWritable(title)
      await this.assertAccessible(targets)
    }

    try {
      return await this.request('POST', ':batchUpdate', { requests })
    } finally {
      this.sheetsCache = null
    }
  }

  range(title: string, cells?: string): string {
    return sheetRange(title, cells)
  }

  private assertWritable(title: string): void {
    const prefix = this.options.writePrefix
    if (prefix && !title.startsWith(prefix)) {
      throw new SheetsWriteBlockedError(title, prefix)
    }
  }

  // Uses the cached tab list, so it rarely costs a request of its own.
  private async assertAccessible(titles: string[]): Promise<void> {
    const pattern = this.options.tabAccess
    if (!pattern) return
    const sheets = await this.listSheets()
    for (const title of titles) {
      const sheet = sheets.find((candidate) => candidate.title === title)
      if (!pattern.test(title) || !sheet || sheet.hidden) throw new SheetsAccessBlockedError(title)
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await getAccessToken(this.options.account)
    const response = await fetch(`${API_ROOT}/${this.options.spreadsheetId}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })

    if (!response.ok) {
      throw new Error(`Sheets API ${method} ${path} failed: ${response.status} ${await response.text()}`)
    }

    return (await response.json()) as T
  }
}

// Titles of the sheets a batchUpdate request would modify. Creating a sheet is
// checked by its new title; any other request by every sheetId it references
// (a duplicate's source sheet is only read, so it is ignored).
function targetTitles(request: BatchUpdateRequest, titles: Map<number, string>): string[] {
  const [kind, payload] = Object.entries(request)[0] as [string, any]

  if (kind === 'duplicateSheet') return [payload.newSheetName ?? '']
  if (kind === 'addSheet') return [payload.properties?.title ?? '']

  const ids = new Set<number>()
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit)
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'sheetId' && typeof value === 'number') ids.add(value)
        else visit(value)
      }
    }
  }
  visit(payload)

  return [...ids].map((id) => titles.get(id) ?? `#${id}`)
}

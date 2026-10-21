import { readFileSync } from 'fs'
import { SheetsClient } from '../../src/sheets/client'

export const TEST_PREFIX = 'TESTE '

// Reads the local secrets the Worker uses in `wrangler dev` (.dev.vars).
export function loadDevVars(path = new URL('../../.dev.vars', import.meta.url)): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match) vars[match[1]] = match[2].trim().replace(/^"(.*)"$/, '$1')
  }
  return vars
}

// Sheets client that can only write to TESTE tabs.
export function testSheetsClient(): SheetsClient {
  const vars = loadDevVars()
  return new SheetsClient({
    account: { clientEmail: vars.GOOGLE_CLIENT_EMAIL, privateKey: vars.GOOGLE_PRIVATE_KEY },
    spreadsheetId: vars.GOOGLE_SPREADSHEET_ID,
    writePrefix: TEST_PREFIX
  })
}

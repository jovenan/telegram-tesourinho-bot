import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { SheetsAccessBlockedError, SheetsClient, SheetsWriteBlockedError } from '../src/sheets/client'
import { monthTabPattern } from '../src/sheets/expenses'

// The write guard is what keeps development away from the real tabs, so it is tested
// against a fake Google API: blocked writes must fail before any write request.
const SHEETS = [
  { properties: { sheetId: 1, title: 'Gastos 10/2026', index: 0, gridProperties: { rowCount: 10, columnCount: 7 } } },
  { properties: { sheetId: 2, title: 'TESTE Gastos 10/2026', index: 1, gridProperties: { rowCount: 10, columnCount: 7 } } },
  { properties: { sheetId: 3, title: 'Viagem', index: 2, gridProperties: { rowCount: 10, columnCount: 7 } } },
  { properties: { sheetId: 4, title: 'Gastos 09/2026', index: 3, hidden: true, gridProperties: { rowCount: 10, columnCount: 7 } } }
]

const requests: string[] = []

const writes: string[] = []
const realFetch = globalThis.fetch
let privateKey = ''

beforeAll(async () => {
  const keys = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64')
  privateKey = `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----\n`

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (!url.includes('oauth2') && !url.includes('fields=sheets.properties')) requests.push(`${method} ${url}`)
    if (url.includes('oauth2')) return Response.json({ access_token: 'token', expires_in: 3600 })
    if (method !== 'GET') writes.push(`${method} ${url}`)
    if (url.includes('fields=sheets.properties')) return Response.json({ sheets: SHEETS })
    return Response.json({})
  }) as typeof fetch
})

afterAll(() => {
  globalThis.fetch = realFetch
})

const client = () =>
  new SheetsClient({
    account: { clientEmail: 'dev@test', privateKey },
    spreadsheetId: 'sheet',
    writePrefix: 'TESTE '
  })

describe('with writePrefix', () => {
  test('blocks writes to real tabs before any request', async () => {
    writes.length = 0
    const sheets = client()

    await expect(sheets.updateValues("'Gastos 10/2026'!A1", [['x']])).rejects.toBeInstanceOf(SheetsWriteBlockedError)
    await expect(sheets.clearValues("'Gastos 10/2026'!A1:B2")).rejects.toBeInstanceOf(SheetsWriteBlockedError)
    await expect(
      sheets.batchUpdate([{ deleteDimension: { range: { sheetId: 1, dimension: 'ROWS', startIndex: 1, endIndex: 2 } } }])
    ).rejects.toBeInstanceOf(SheetsWriteBlockedError)
    await expect(
      sheets.batchUpdate([{ duplicateSheet: { sourceSheetId: 2, newSheetName: 'Copia' } }])
    ).rejects.toBeInstanceOf(SheetsWriteBlockedError)

    expect(writes).toEqual([])
  })

  test('allows writes to TESTE tabs', async () => {
    writes.length = 0
    const sheets = client()

    await sheets.updateValues("'TESTE Gastos 10/2026'!A1", [['x']])
    await sheets.batchUpdate([{ deleteDimension: { range: { sheetId: 2, dimension: 'ROWS', startIndex: 1, endIndex: 2 } } }])
    // Duplicating a real tab into a TESTE copy only reads the source.
    await sheets.batchUpdate([{ duplicateSheet: { sourceSheetId: 1, newSheetName: 'TESTE Copia' } }])

    expect(writes).toHaveLength(3)
  })
})

describe('with tabAccess', () => {
  const guarded = () =>
    new SheetsClient({ account: { clientEmail: 'dev@test', privateKey }, spreadsheetId: 'sheet', tabAccess: monthTabPattern() })

  test('blocks reads and writes outside visible month tabs before any request', async () => {
    requests.length = 0
    const sheets = guarded()

    await expect(sheets.getValues("'Viagem'!A1:B2")).rejects.toBeInstanceOf(SheetsAccessBlockedError)
    await expect(sheets.getValues("'Gastos 09/2026'!A1:B2")).rejects.toBeInstanceOf(SheetsAccessBlockedError)
    await expect(sheets.getDataValidation("'Viagem'!E2:F2")).rejects.toBeInstanceOf(SheetsAccessBlockedError)
    await expect(sheets.updateValues("'Viagem'!A1", [['x']])).rejects.toBeInstanceOf(SheetsAccessBlockedError)
    await expect(sheets.clearValues("'Gastos 09/2026'!A1")).rejects.toBeInstanceOf(SheetsAccessBlockedError)
    await expect(
      sheets.batchUpdate([{ insertDimension: { range: { sheetId: 3, dimension: 'ROWS', startIndex: 1, endIndex: 2 } } }])
    ).rejects.toBeInstanceOf(SheetsAccessBlockedError)

    expect(requests).toEqual([])
  })

  test('allows visible month tabs', async () => {
    requests.length = 0
    const sheets = guarded()

    await sheets.getValues("'Gastos 10/2026'!C1:G1")
    await sheets.updateValues("'Gastos 10/2026'!C2", [['x']])
    await sheets.batchUpdate([{ insertDimension: { range: { sheetId: 1, dimension: 'ROWS', startIndex: 1, endIndex: 2 } } }])

    expect(requests).toHaveLength(3)
  })
})

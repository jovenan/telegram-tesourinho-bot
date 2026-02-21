import { google } from 'googleapis'
import type { Expense } from './types'

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID || ''
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'Gastos'

const credentials = {
  client_email: process.env.GOOGLE_CLIENT_EMAIL || '',
  private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
}

const auth = new google.auth.JWT({
  email: credentials.client_email,
  key: credentials.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
})

const sheets = google.sheets({ version: 'v4', auth })

// Cache to avoid fetching on every message
let sourcesCache: string[] = []
let categoriesCache: string[] = []
let lastFetch = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

async function fetchUniqueValues(column: string): Promise<string[]> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!${column}:${column}`
  })

  const rows = response.data.values || []
  const values = rows
    .flat()
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .slice(1) // skip header

  return Array.from(new Set(values))
}

export async function getSources(): Promise<string[]> {
  const now = Date.now()
  if (sourcesCache.length > 0 && now - lastFetch < CACHE_TTL) {
    return sourcesCache
  }

  try {
    sourcesCache = await fetchUniqueValues('E')
    lastFetch = now
    return sourcesCache
  } catch (error) {
    console.error('Error fetching sources:', error)
    return sourcesCache.length > 0 ? sourcesCache : []
  }
}

export async function getCategories(): Promise<string[]> {
  const now = Date.now()
  if (categoriesCache.length > 0 && now - lastFetch < CACHE_TTL) {
    return categoriesCache
  }

  try {
    categoriesCache = await fetchUniqueValues('F')
    lastFetch = now
    return categoriesCache
  } catch (error) {
    console.error('Error fetching categories:', error)
    return categoriesCache.length > 0 ? categoriesCache : []
  }
}

export async function addExpense(expense: Expense): Promise<boolean> {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!D:D`
    })

    const rows = response.data.values || []
    const nextRow = rows.length + 1

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!D${nextRow}:G${nextRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[expense.description, expense.source, expense.category, expense.value]]
      }
    })
    return true
  } catch (error) {
    console.error('Error adding expense:', error)
    return false
  }
}

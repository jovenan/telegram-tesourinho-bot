import type { Env, Expense, TravelExpense } from './types'

const FIXED_CATEGORIES = [
  'Mercado',
  'Restaurantes e Delivery',
  'Transporte',
  'Conta de Agua e Luz',
  'Moradia',
  'Internet e plano telefonico',
  'Assinaturas',
  'Saúde',
  'Lazer',
  'Educação',
  'Impostos',
  'Vestimentas',
  'Variados',
  'Viagem',
  'Presentes',
  'Pet',
  'Carro',
  'Investimentos'
]

// Cache for access token
let accessToken: string | null = null
let tokenExpiry = 0

// Cache for sources
let sourcesCache: string[] = []
let lastFetch = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

function base64UrlEncode(data: string | ArrayBuffer): string {
  const bytes = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : new Uint8Array(data)

  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '')

  const binaryString = atob(pemContents)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }

  return crypto.subtle.importKey(
    'pkcs8',
    bytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
}

async function createJWT(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const privateKey = env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')

  const header = {
    alg: 'RS256',
    typ: 'JWT'
  }

  const payload = {
    iss: env.GOOGLE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }

  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const unsignedToken = `${encodedHeader}.${encodedPayload}`

  const key = await importPrivateKey(privateKey)
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsignedToken)
  )

  const encodedSignature = base64UrlEncode(signature)
  return `${unsignedToken}.${encodedSignature}`
}

async function getAccessToken(env: Env): Promise<string> {
  const now = Date.now()

  if (accessToken && now < tokenExpiry) {
    return accessToken
  }

  const jwt = await createJWT(env)

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  })

  const data = await response.json() as { access_token: string; expires_in: number }

  accessToken = data.access_token
  tokenExpiry = now + (data.expires_in * 1000) - 60000 // 1 min buffer

  return accessToken
}

function getDefaultSheetName(env: Env): string {
  return env.GOOGLE_SHEET_NAME || 'Gastos'
}

function getTravelSheetName(env: Env): string {
  return env.GOOGLE_TRAVEL_SHEET_NAME || 'Viagem'
}

async function fetchSheetValues(env: Env, range: string, sheetName = getDefaultSheetName(env)): Promise<string[][]> {
  const token = await getAccessToken(env)
  const encodedRange = encodeURIComponent(`${sheetName}!${range}`)

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SPREADSHEET_ID}/values/${encodedRange}`,
    {
      headers: { Authorization: `Bearer ${token}` }
    }
  )

  const data = await response.json() as { values?: string[][] }
  return data.values || []
}

async function updateSheetValues(env: Env, range: string, values: string[][], sheetName = getDefaultSheetName(env)): Promise<boolean> {
  const token = await getAccessToken(env)
  const encodedRange = encodeURIComponent(`${sheetName}!${range}`)

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SPREADSHEET_ID}/values/${encodedRange}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values })
    }
  )

  return response.ok
}

async function fetchUniqueValues(env: Env, column: string): Promise<string[]> {
  const rows = await fetchSheetValues(env, `${column}:${column}`)

  const values = rows
    .flat()
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .slice(1) // skip header

  return Array.from(new Set(values))
}

function normalizeExpenseValue(value: Expense['value']): number {
  if (typeof value === 'number') {
    return value
  }

  const numericValue = value.replace(/[^\d,.-]/g, '')
  const lastComma = numericValue.lastIndexOf(',')
  const lastDot = numericValue.lastIndexOf('.')
  const decimalSeparator = lastComma > lastDot ? ',' : '.'
  const thousandsSeparator = decimalSeparator === ',' ? '.' : ','
  const normalized = numericValue
    .replace(new RegExp(`\\${thousandsSeparator}`, 'g'), '')
    .replace(decimalSeparator, '.')

  return Number(normalized)
}

function formatExpenseValueForSheet(value: number): string {
  return value.toString().replace('.', ',')
}

export async function getSources(env: Env): Promise<string[]> {
  const now = Date.now()
  if (sourcesCache.length > 0 && now - lastFetch < CACHE_TTL) {
    return sourcesCache
  }

  try {
    sourcesCache = await fetchUniqueValues(env, 'E')
    lastFetch = now
    return sourcesCache
  } catch (error) {
    console.error('Error fetching sources:', error)
    return sourcesCache.length > 0 ? sourcesCache : []
  }
}

export async function getCategories(): Promise<string[]> {
  return FIXED_CATEGORIES
}

export async function addExpense(env: Env, expense: Expense): Promise<boolean> {
  try {
    const rows = await fetchSheetValues(env, 'D:D')
    const nextRow = rows.length + 1
    const value = normalizeExpenseValue(expense.value)

    if (!Number.isFinite(value)) {
      throw new Error(`Invalid expense value: ${expense.value}`)
    }

    const success = await updateSheetValues(
      env,
      `D${nextRow}:G${nextRow}`,
      [[expense.description, expense.source, expense.category, formatExpenseValueForSheet(value)]]
    )

    return success
  } catch (error) {
    console.error('Error adding expense:', error)
    return false
  }
}

function parseSheetNumber(value: string | undefined): number {
  if (!value) return 0
  return normalizeExpenseValue(value)
}

export async function addTravelExpense(env: Env, expense: TravelExpense): Promise<boolean> {
  try {
    const sheetName = getTravelSheetName(env)
    const rows = await fetchSheetValues(env, 'A:A', sheetName)
    const nextRow = rows.length + 1
    const value = normalizeExpenseValue(expense.value)

    if (!Number.isFinite(value)) {
      throw new Error(`Invalid travel expense value: ${expense.value}`)
    }

    return await updateSheetValues(
      env,
      `A${nextRow}:H${nextRow}`,
      [[
        expense.date,
        expense.country,
        expense.city,
        expense.person,
        expense.description,
        expense.category,
        expense.source,
        formatExpenseValueForSheet(value)
      ]],
      sheetName
    )
  } catch (error) {
    console.error('Error adding travel expense:', error)
    return false
  }
}

export async function getTravelExpenses(env: Env): Promise<TravelExpense[]> {
  try {
    const rows = await fetchSheetValues(env, 'A:H', getTravelSheetName(env))

    return rows.slice(1).map((row) => ({
      date: row[0] || '',
      country: row[1] || '',
      city: row[2] || '',
      person: row[3] || '',
      description: row[4] || '',
      category: row[5] || '',
      source: row[6] || '',
      value: parseSheetNumber(row[7])
    })).filter((expense) => expense.date && Number(expense.value) > 0)
  } catch (error) {
    console.error('Error fetching travel expenses:', error)
    return []
  }
}

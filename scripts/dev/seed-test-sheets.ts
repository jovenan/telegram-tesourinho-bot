// Fills the TESTE tabs with fictional data so the agent has something to read.
// Clears the expense table (C–G) and income entries (A2:B5) of each TESTE tab first;
// the summary formulas in A–B are left alone. Never touches other tabs.
//
// Usage: bun scripts/dev/seed-test-sheets.ts
import { TEST_PREFIX, testSheetsClient } from './env'

type Expense = [day: number, description: string, source: string, category: string, value: string]

// Rows 2–5 of the income section; B6 sums them and the "Saldos" formulas read B2–B4
// (B3 is the meal allowance, paired with the Flash card).
const INCOME: Array<[string, string]> = [
  ['Salário (fictício)', '10000'],
  ['VA/VR (fictício)', '1200'],
  ['Freela (fictício)', '1500']
]

const EXPENSES: Expense[] = [
  [2, 'ASSAI ATACADISTA', 'Nubank', 'Mercado', '412,35'],
  [3, 'IFOOD *IFOOD', 'C6', 'Restaurantes e Delivery', '58,90'],
  [5, 'UBER *TRIP', 'C6', 'Transporte', '23,40'],
  [6, 'NETFLIX.COM', 'Nubank', 'Assinaturas', '55,90'],
  [8, 'DROGASIL', 'Débito/Dinheiro', 'Saúde', '87,15'],
  [9, 'POSTO SHELL', 'Elo grafite', 'Combustivel', '250,00'],
  [11, 'PETZ', 'Nubank', 'Pet', '139,99'],
  [12, 'TENIS CORRIDA (2/5)', 'Nubank', 'Vestimentas', '119,80'],
  [13, 'PAO DE ACUCAR', 'Flash', 'Mercado', '96,42'],
  [14, 'CINEMARK', 'C6', 'Lazer', '64,00']
]

const sheets = testSheetsClient()
const monthOf = (title: string) => title.match(/(\d{2})\/(\d{4})$/)!
const monthKey = (title: string) => {
  const [, month, year] = monthOf(title)
  return `${year}${month}`
}
const tabs = (await sheets.listSheets())
  .filter((sheet) => sheet.title.startsWith(`${TEST_PREFIX}Gastos `))
  .sort((a, b) => monthKey(a.title).localeCompare(monthKey(b.title)))

if (tabs.length === 0) {
  throw new Error('Nenhuma aba TESTE encontrada. Rode setup-test-sheets.ts antes.')
}

for (const [i, tab] of tabs.entries()) {
  const [, month, year] = monthOf(tab.title)

  await sheets.clearValues(sheets.range(tab.title, `C2:G${tab.rowCount}`))
  await sheets.clearValues(sheets.range(tab.title, 'A2:B5'))

  // Later months get fewer rows, like a month that is still being filled.
  const expenses = EXPENSES.slice(0, EXPENSES.length - i * 3).map(([day, ...rest]) => [
    `${String(day).padStart(2, '0')}/${month}/${year}`,
    ...rest
  ])

  await sheets.updateValues(sheets.range(tab.title, `A2:B${INCOME.length + 1}`), INCOME)
  await sheets.updateValues(sheets.range(tab.title, `C2:G${expenses.length + 1}`), expenses)

  console.log(`~ ${tab.title}: ${INCOME.length} rendas, ${expenses.length} gastos`)
}

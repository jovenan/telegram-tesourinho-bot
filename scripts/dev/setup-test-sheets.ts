// Creates "TESTE Gastos MM/YYYY" tabs by duplicating a real month tab. The copy keeps
// formatting, dropdowns and the summary formulas in A–B (Gastos/Saldos sections);
// the expense table (C–G), the income entries (A2:B5) and loose notes in H–K are cleared, so no real
// values remain. The real tabs are only read. Existing test tabs are skipped unless
// --recreate is passed, which deletes and rebuilds them.
//
// Usage: bun scripts/dev/setup-test-sheets.ts [--recreate] [template tab] [MM/YYYY ...]
import { TEST_PREFIX, testSheetsClient } from './env'

const args = process.argv.slice(2)
const recreate = args.includes('--recreate')
const [template = 'Gastos 12/2026', ...months] = args.filter((arg) => arg !== '--recreate')
const targetMonths = months.length > 0 ? months : ['10/2026', '11/2026', '12/2026']

const sheets = testSheetsClient()
let existing = await sheets.listSheets()
const source = existing.find((sheet) => sheet.title === template)

if (!source) {
  throw new Error(`Template tab "${template}" not found`)
}

if (recreate) {
  const stale = existing.filter((sheet) => targetMonths.some((month) => sheet.title === `${TEST_PREFIX}Gastos ${month}`))
  if (stale.length > 0) {
    await sheets.batchUpdate(stale.map((sheet) => ({ deleteSheet: { sheetId: sheet.sheetId } })))
    stale.forEach((sheet) => console.log(`- ${sheet.title} removida`))
    existing = await sheets.listSheets()
  }
}

// Dropdown rules of the template (row 2 of "Fonte de saida" E and "Categoria" F).
// duplicateSheet does not always carry them over, so they are applied explicitly.
const templateRules = await sheets.getDataValidation(sheets.range(template, 'E2:F2'))
const ruleFor = (column: number) => templateRules.find((r) => r.column === column)?.rule

async function applyDropdowns(sheetId: number, rowCount: number) {
  await sheets.batchUpdate(
    [4, 5].flatMap((column) => {
      const rule = ruleFor(column)
      return rule
        ? [{ setDataValidation: { range: { sheetId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: column, endColumnIndex: column + 1 }, rule } }]
        : []
    })
  )
}

for (const [i, month] of targetMonths.entries()) {
  const title = `${TEST_PREFIX}Gastos ${month}`

  const current = existing.find((sheet) => sheet.title === title)
  if (current) {
    await applyDropdowns(current.sheetId, current.rowCount)
    console.log(`= ${title} já existe (dropdowns reaplicados)`)
    continue
  }

  const result = await sheets.batchUpdate([
    { duplicateSheet: { sourceSheetId: source.sheetId, newSheetName: title, insertSheetIndex: existing.length + i } }
  ])
  const sheetId: number = result.replies?.[0]?.duplicateSheet?.properties?.sheetId

  await sheets.clearValues(sheets.range(title, `C2:G${source.rowCount}`))
  await sheets.clearValues(sheets.range(title, 'A2:B5'))
  await sheets.clearValues(sheets.range(title, `H1:K${source.rowCount}`))
  await sheets.batchUpdate([
    { updateSheetProperties: { properties: { sheetId, tabColorStyle: { rgbColor: { red: 1, green: 0.6, blue: 0 } } }, fields: 'tabColorStyle' } }
  ])
  await applyDropdowns(sheetId, source.rowCount)

  console.log(`+ ${title} criada (sheetId ${sheetId})`)
}

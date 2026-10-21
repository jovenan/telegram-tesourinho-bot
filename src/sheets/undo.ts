import type { CellValue, SheetsClient } from './client'
import { columnLetter } from './a1'

// How to revert one write. Values are captured with formulas (not computed values),
// so restoring them brings back exactly what was there.
export type UndoOp =
  | { type: 'restore'; range: string; values: CellValue[][] }
  | { type: 'reinsert_rows'; sheet: string; startIndex: number; values: CellValue[][] }

// Reads a range as formulas, padded to its full size (the API trims trailing blanks).
export async function snapshot(client: SheetsClient, range: string, rows: number, columns: number): Promise<CellValue[][]> {
  const values = await client.getValues(range, 'FORMULA')
  return Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) => values[r]?.[c] ?? ''))
}

export function blank(rows: number, columns: number): CellValue[][] {
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => ''))
}

// Applies undo operations in reverse order of the original writes.
export async function applyUndo(client: SheetsClient, ops: UndoOp[]): Promise<void> {
  for (const op of [...ops].reverse()) {
    if (op.type === 'restore') {
      await client.updateValues(op.range, op.values)
      continue
    }

    const sheet = (await client.listSheets()).find((s) => s.title === op.sheet)
    if (!sheet) throw new Error(`A aba "${op.sheet}" não existe mais.`)

    await client.batchUpdate([
      {
        insertDimension: {
          range: { sheetId: sheet.sheetId, dimension: 'ROWS', startIndex: op.startIndex, endIndex: op.startIndex + op.values.length },
          inheritFromBefore: op.startIndex > 0
        }
      }
    ])
    const width = Math.max(1, ...op.values.map((row) => row.length))
    await client.updateValues(
      client.range(op.sheet, `A${op.startIndex + 1}:${columnLetter(width - 1)}${op.startIndex + op.values.length}`),
      op.values
    )
  }
}

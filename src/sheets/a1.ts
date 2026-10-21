// Sheet titles in A1 notation must be quoted when they contain spaces or symbols
// ("Gastos 10/2026"); a literal quote is escaped by doubling it.
export function quoteSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`
}

export function sheetRange(title: string, cells?: string): string {
  return cells ? `${quoteSheetTitle(title)}!${cells}` : quoteSheetTitle(title)
}

export function parseSheetTitle(range: string): string {
  const bang = range.lastIndexOf('!')
  const title = bang === -1 ? range : range.slice(0, bang)

  if (title.startsWith("'") && title.endsWith("'")) {
    return title.slice(1, -1).replace(/''/g, "'")
  }

  return title
}

export function columnLetter(index: number): string {
  let letter = ''
  let n = index + 1
  while (n > 0) {
    const remainder = (n - 1) % 26
    letter = String.fromCharCode(65 + remainder) + letter
    n = Math.floor((n - 1) / 26)
  }
  return letter
}

export function columnIndex(letters: string): number {
  return letters
    .toUpperCase()
    .split('')
    .reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1
}

// "F12" → { column: 5, row: 12 }. Returns null for anything that is not a single cell.
export function parseCell(cell: string): { column: number; row: number } | null {
  const match = cell.trim().match(/^([A-Z]+)(\d+)$/i)
  if (!match || Number(match[2]) < 1) return null
  return { column: columnIndex(match[1]), row: Number(match[2]) }
}

// Range covering `rows` × `columns` cells starting at a cell, e.g. ("F12", 2, 2) → "F12:G13".
export function rangeFrom(start: { column: number; row: number }, rows: number, columns: number): string {
  const end = { column: start.column + columns - 1, row: start.row + rows - 1 }
  return `${columnLetter(start.column)}${start.row}:${columnLetter(end.column)}${end.row}`
}

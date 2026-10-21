// Decodes a bank export: UTF-8 when valid, otherwise Windows-1252 (common in
// Brazilian bank CSVs).
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    try {
      return new TextDecoder('windows-1252').decode(bytes)
    } catch {
      return new TextDecoder('utf-8').decode(bytes)
    }
  }
}

function detectDelimiter(firstLine: string): string {
  const counts = [',', ';', '\t'].map((delimiter) => {
    let count = 0
    let quoted = false
    for (const char of firstLine) {
      if (char === '"') quoted = !quoted
      else if (char === delimiter && !quoted) count++
    }
    return { delimiter, count }
  })
  return counts.sort((a, b) => b.count - a.count)[0].count > 0 ? counts[0].delimiter : ','
}

// RFC 4180 parser: quoted fields, escaped quotes (""), CRLF, BOM. Empty lines are
// dropped and cells are trimmed.
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, '')
  const delimiter = detectDelimiter(input.split(/\r?\n/, 1)[0] ?? '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  const endCell = () => {
    row.push(cell.trim())
    cell = ''
  }
  const endRow = () => {
    endCell()
    if (row.some((value) => value !== '')) rows.push(row)
    row = []
  }

  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        cell += '"'
        i++
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === delimiter) {
      endCell()
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++
      endRow()
    } else {
      cell += char
    }
  }
  if (cell !== '' || row.length > 0) endRow()

  return rows
}

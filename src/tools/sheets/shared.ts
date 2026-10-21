import { escapeHtml } from '../../telegram/format'
import { formatBrl, type ExpenseOptions, type Spreadsheet } from '../../sheets/expenses'
import type { CellValue } from '../../sheets/client'
import { ToolError } from '../registry'

export const AI_SUFFIX = ' - AI GENERATED'
export const MAX_ROWS_PER_WRITE = 100
export const MAX_DELETE_ROWS = 20

export const html = escapeHtml
export const brl = formatBrl

export const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

// Matches a value against a dropdown list, ignoring case and accents, and returns the
// exact option (the sheet only accepts the canonical spelling).
export function canonicalOption(value: string, options: string[], label: string): string {
  // A column without a dropdown accepts anything.
  if (options.length === 0) return value
  const match = options.find((option) => normalize(option) === normalize(value))
  if (!match) {
    throw new ToolError(`${label} inválida: "${value}". Opções válidas: ${options.join(', ')}.`)
  }
  return match
}

// Dropdown options per expense tab, fetched once per tool call.
export function optionsLoader(spreadsheet: Spreadsheet): (title: string) => Promise<ExpenseOptions> {
  const cache = new Map<string, Promise<ExpenseOptions>>()
  return (title) => {
    if (!cache.has(title)) cache.set(title, spreadsheet.optionsIn(title))
    return cache.get(title)!
  }
}

// Line breaks and control characters never belong in a cell; they show up when the
// model's output is garbled, so the write is refused instead of saved.
export function assertCleanValues(values: string[][]): void {
  const bad = values.flat().find((value) => /[\u0000-\u001f]/.test(value))
  if (bad !== undefined) throw new ToolError(`Valor com caractere inválido: ${JSON.stringify(bad)}. Reenvie sem quebras de linha.`)
}

// Throws if the cells changed since the preview was built.
export function assertUnchanged(before: CellValue[][], now: CellValue[][]): void {
  const same = before.every((row, r) => row.every((cell, c) => String(cell ?? '') === String(now[r]?.[c] ?? '')))
  if (!same) {
    throw new ToolError('A planilha mudou desde que a prévia foi feita. Consulte de novo e proponha a alteração outra vez.')
  }
}

// "15/10/2026" → { day, month, year }; throws on anything else.
export function parseDate(text: string): { day: number; month: number; year: number } {
  const match = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  const [day, month, year] = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0]
  const valid = match && month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (!valid) throw new ToolError(`Data inválida: "${text}". Use dd/mm/aaaa.`)
  return { day, month, year }
}

export function formatDateParts({ day, month, year }: { day: number; month: number; year: number }): string {
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`
}

// Same day `offset` months later, clamped to the month's length (31/01 + 1 → 28/02).
export function addMonths(date: { day: number; month: number; year: number }, offset: number) {
  const index = date.month - 1 + offset
  const year = date.year + Math.floor(index / 12)
  const month = (index % 12) + 1
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { day: Math.min(date.day, lastDay), month, year }
}

export function monthOf(date: { month: number; year: number }): string {
  return `${String(date.month).padStart(2, '0')}/${date.year}`
}

// Rough "same expense" check: same value and descriptions sharing their first word.
export function looksDuplicate(a: { description: string; value: number | null }, b: { description: string; value: number }): boolean {
  if (a.value === null || Math.abs(a.value - b.value) >= 0.005) return false
  const firstWord = (text: string) => normalize(text).split(/[^a-z0-9]+/).find((word) => word.length >= 3) ?? normalize(text)
  return firstWord(a.description) === firstWord(b.description)
}

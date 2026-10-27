import type { CalendarDay } from '../utils/dates'

// Comparison key for dropdown options and sources: case and accents ignored.
export const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

// "15/10/2026", as written in column C.
export function sheetDate({ day, month, year }: CalendarDay): string {
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`
}

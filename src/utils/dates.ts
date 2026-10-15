export const TIME_ZONE = 'America/Sao_Paulo'

interface DateParts {
  year: string
  month: string
  day: string
  hour: string
  minute: string
  weekday: string
}

function parts(date: Date): DateParts {
  const formatted = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23'
  }).formatToParts(date)

  const get = (type: Intl.DateTimeFormatPartTypes) => formatted.find((part) => part.type === type)?.value ?? ''
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    weekday: get('weekday').replace('.', '')
  }
}

// "qui, 15/10/2026 17:05" — prefixed to every user message so the model knows "now"
// without putting the date in the (frozen) system prompt.
export function messageTimestamp(date: Date): string {
  const p = parts(date)
  return `${p.weekday}, ${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`
}

// "2026-10" — key for monthly accounting.
export function monthKey(date: Date): string {
  const p = parts(date)
  return `${p.year}-${p.month}`
}

// "10/2026" — month as used in the spreadsheet tab names.
export function monthLabel(date: Date): string {
  const p = parts(date)
  return `${p.month}/${p.year}`
}

// "15/10/2026"
export function formatDate(date: Date): string {
  const p = parts(date)
  return `${p.day}/${p.month}/${p.year}`
}

export interface CalendarDay {
  year: number
  month: number
  day: number
}

// Today's date in São Paulo.
export function today(date: Date = new Date()): CalendarDay {
  const p = parts(date)
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day) }
}

export function addDays(day: CalendarDay, offset: number): CalendarDay {
  const date = new Date(Date.UTC(day.year, day.month - 1, day.day + offset))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}

// 0 = Sunday … 6 = Saturday
export function weekday(day: CalendarDay): number {
  return new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay()
}

// Comparable number (20261015) for date ranges.
export function dayKey(day: CalendarDay): number {
  return day.year * 10000 + day.month * 100 + day.day
}

// "15/10/2026" or "15/10/26" → CalendarDay; null when the text is not a date.
export function parseSheetDate(text: string): CalendarDay | null {
  const match = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
  if (!match) return null
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])
  return { year, month: Number(match[2]), day: Number(match[1]) }
}

export function monthLabelOf(day: Pick<CalendarDay, 'year' | 'month'>): string {
  return `${String(day.month).padStart(2, '0')}/${day.year}`
}

export function formatDay(day: CalendarDay): string {
  return `${String(day.day).padStart(2, '0')}/${String(day.month).padStart(2, '0')}`
}

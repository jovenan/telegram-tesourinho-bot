import { expect, test } from 'bun:test'
import { CRON_JOBS, weekOf } from '../src/proactive'
import { addDays, parseSheetDate, today, weekday } from '../src/utils/dates'

test('weeks run Monday to Sunday', () => {
  // 18/10/2026 is a Sunday
  expect(weekday({ year: 2026, month: 10, day: 18 })).toBe(0)
  expect(weekOf({ year: 2026, month: 10, day: 18 })).toEqual({
    start: { year: 2026, month: 10, day: 12 },
    end: { year: 2026, month: 10, day: 18 }
  })
  expect(weekOf({ year: 2026, month: 11, day: 2 }).start).toEqual({ year: 2026, month: 11, day: 2 })
})

test('addDays crosses months', () => {
  expect(addDays({ year: 2026, month: 10, day: 31 }, 1)).toEqual({ year: 2026, month: 11, day: 1 })
})

test('parseSheetDate', () => {
  expect(parseSheetDate('02/10/2026')).toEqual({ year: 2026, month: 10, day: 2 })
  expect(parseSheetDate('2/10/26')).toEqual({ year: 2026, month: 10, day: 2 })
  expect(parseSheetDate('pago')).toBeNull()
})

test('today is São Paulo time', () => {
  expect(today(new Date('2026-11-01T01:30:00Z'))).toEqual({ year: 2026, month: 10, day: 31 })
})

test('cron schedule matches São Paulo times', () => {
  expect(Object.values(CRON_JOBS).sort()).toEqual(['month_close', 'weekly_reminder', 'weekly_summary'])
})

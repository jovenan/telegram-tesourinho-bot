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

test('crons match wrangler.toml and use day names', async () => {
  expect(Object.values(CRON_JOBS).flat().sort()).toEqual(['bank_fetch', 'maintenance', 'month_close', 'weekly_reminder', 'weekly_summary'])
  const toml = await Bun.file(new URL('../wrangler.toml', import.meta.url)).text()
  const configured = JSON.parse(toml.match(/^crons = (\[.*\])$/m)![1])
  expect(configured.sort()).toEqual(Object.keys(CRON_JOBS).sort())
  expect(configured.every((cron: string) => !/ [0-7]$/.test(cron))).toBe(true)
})

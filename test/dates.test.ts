import { expect, test } from 'bun:test'
import { formatDate, messageTimestamp, monthKey, monthLabel } from '../src/utils/dates'

// 2026-11-01 01:30 UTC is still 31/10 22:30 in São Paulo (UTC−3).
const date = new Date('2026-11-01T01:30:00Z')

test('dates are in São Paulo time', () => {
  expect(formatDate(date)).toBe('31/10/2026')
  expect(monthKey(date)).toBe('2026-10')
  expect(monthLabel(date)).toBe('10/2026')
  expect(messageTimestamp(date)).toBe('sáb, 31/10/2026 22:30')
})

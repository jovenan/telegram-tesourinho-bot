import { describe, expect, test } from 'bun:test'
import { formatBrl, normalizeMonth, parseBrl, parseExpenseRows, parsePanel } from '../src/sheets/expenses'

describe('parseBrl', () => {
  test.each([
    ['R$ 1.234,56', 1234.56],
    ['R$ 89,27', 89.27],
    ['1234,5', 1234.5],
    ['-12,30', -12.3],
    [412.35, 412.35]
  ])('%p → %p', (input, expected) => {
    expect(parseBrl(input)).toBe(expected)
  })

  test.each(['', 'abc', 'R$ -', undefined])('%p is not a number', (input) => {
    expect(parseBrl(input as string)).toBeNull()
  })
})

test('formatBrl', () => {
  expect(formatBrl(1234.5)).toBe('R$ 1.234,50')
  expect(formatBrl(0.1)).toBe('R$ 0,10')
})

describe('normalizeMonth', () => {
  test.each([
    ['10/2026', '10/2026'],
    ['3/2026', '03/2026'],
    ['2026-10', '10/2026'],
    ['10-2026', '10/2026']
  ])('%p → %p', (input, expected) => {
    expect(normalizeMonth(input)).toBe(expected)
  })

  test.each(['13/2026', '00/2026', 'outubro', '2026'])('%p is invalid', (input) => {
    expect(normalizeMonth(input)).toBeNull()
  })
})

test('parseExpenseRows keeps sheet row numbers and skips rows without description', () => {
  const rows = parseExpenseRows([
    ['02/10/2026', 'ASSAI', 'Nubank', 'Mercado', 'R$ 412,35'],
    ['', '', '', '', ''],
    ['', 'UBER *TRIP', 'C6', 'Transporte', 'R$ 23,40'],
    ['texto', '']
  ])

  expect(rows).toEqual([
    { row: 2, date: '02/10/2026', description: 'ASSAI', source: 'Nubank', category: 'Mercado', value: 412.35 },
    { row: 4, date: '', description: 'UBER *TRIP', source: 'C6', category: 'Transporte', value: 23.4 }
  ])
})

test('parsePanel splits sections at "Valor" headers', () => {
  const panel = parsePanel([
    ['Renda', 'Valor'],
    ['Salário', 'R$ 10.000,00'],
    [],
    ['Total renda', 'R$ 10.000,00'],
    ['Gastos', 'Valor'],
    ['Total C6', 'R$ 146,30'],
    ['Saldos', 'Valor'],
    ['Saldo Geral', 'R$ 9.853,70']
  ])

  expect(panel.sections.map((s) => s.title)).toEqual(['Renda', 'Gastos', 'Saldos'])
  expect(panel.sections[0].entries).toEqual([
    { label: 'Salário', value: 'R$ 10.000,00' },
    { label: 'Total renda', value: 'R$ 10.000,00' }
  ])
})

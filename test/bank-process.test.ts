import { expect, test } from 'bun:test'
import { processTransactions, type PendingTx, type ProcessDeps, type ResolvedTx } from '../src/bank/process'
import type { Expense } from '../src/sheets/expenses'

const CATEGORIES = ['Transporte', 'Lazer', 'Restaurantes e Delivery', 'Mercado']
const tx = (id: string, date: string, description: string, amount: number, extra: Partial<PendingTx> = {}): PendingTx => ({
  id,
  accountId: 'acc-c6',
  date,
  description,
  amount,
  billDueDate: null,
  installmentNumber: null,
  totalInstallments: null,
  mcc: null,
  providerCategory: null,
  ...extra
})

function deps(sheet: Record<string, Expense[]>, extra: Partial<ProcessDeps> = {}) {
  const asked: string[] = []
  const value: ProcessDeps = {
    cards: [{ accountId: 'acc-c6', source: 'C6', dueDay: 5, closingDaysBeforeDue: 7 }],
    monthTabTitle: (month) => `Gastos ${month}`,
    hasTab: async (title) => title in sheet,
    expensesIn: async (title) => sheet[title] ?? [],
    optionsIn: async () => ({ sources: ['C6', 'Nubank'], categories: CATEGORIES }),
    resolved: [],
    categorize: async (items) => {
      asked.push(...items.map((item) => item.description))
      return new Map(items.filter((item) => item.description.startsWith('CINEMARK')).map((item) => [item.idx, 'Lazer']))
    },
    ...extra
  }
  return { value, asked }
}

test('matches, suggests and groups by the bill month', async () => {
  const sheet = {
    'Gastos 11/2026': [{ row: 5, date: '', description: 'Uber', source: 'C6', category: 'Transporte', value: 23.1 }],
    'Gastos 12/2026': []
  }
  const resolved: ResolvedTx[] = [
    { tab: 'Gastos 10/2026', source: 'C6', amount: 40, merchantKey: 'ifd restaurante xyz', category: 'Restaurantes e Delivery', state: 'imported', updatedAt: 1 }
  ]
  const { value, asked } = deps(sheet, { resolved })

  const result = await processTransactions(
    [
      tx('t1', '2026-10-16', 'UBER *TRIP', 23.1),
      tx('t2', '2026-10-17', 'UBER *TRIP', 23.1),
      tx('t3', '2026-10-18', 'IFD*RESTAURANTE XYZ', 52.9),
      tx('t4', '2026-10-30', 'CINEMARK', 64),
      tx('t5', '2026-10-20', 'PAG*JOSEDASILVA', 80)
    ],
    value
  )

  // The typed "Uber" row is the first Uber purchase; the second one is new.
  expect(result.inSheet).toEqual([{ id: 't1', tab: 'Gastos 11/2026', source: 'C6', merchantKey: 'uber trip', row: 5, category: 'Transporte' }])
  const byId = Object.fromEntries(result.items.map((item) => [item.id, item]))
  expect(Object.keys(byId).sort()).toEqual(['t2', 't3', 't4', 't5'])

  // The matched row teaches "uber trip" → Transporte (no model call).
  expect(byId.t2).toMatchObject({ tab: 'Gastos 11/2026', suggestion: 'Transporte', suggestionKind: 'rule', date: '17/10/2026' })
  expect(byId.t3).toMatchObject({ suggestion: 'Restaurantes e Delivery', suggestionKind: 'rule' })
  // Bought after the closing day: December's tab.
  expect(byId.t4).toMatchObject({ tab: 'Gastos 12/2026', suggestion: 'Lazer', suggestionKind: 'llm' })
  expect(byId.t5).toMatchObject({ suggestion: null, suggestionKind: null })
  expect(asked.sort()).toEqual(['CINEMARK', 'PAG*JOSEDASILVA'])
})

test('missing tabs wait; a typed row with a far date is a possible duplicate', async () => {
  const sheet = {
    'Gastos 11/2026': [{ row: 8, date: '01/10/2026', description: 'Mercado', source: 'C6', category: 'Mercado', value: 210 }]
  }
  const { value } = deps(sheet)

  const result = await processTransactions([tx('a', '2026-10-21', 'MERCADO X', 210), tx('b', '2026-10-31', 'LOJA', 10)], value)

  expect(result.waiting).toEqual(new Map([['Gastos 12/2026', ['b']]]))
  expect(result.items).toHaveLength(1)
  expect(result.items[0]).toMatchObject({ id: 'a', duplicate: { row: 8 }, suggestion: 'Mercado', suggestionKind: 'rule' })
})

test('installments carry (k/n) and the bank bill decides the tab', async () => {
  const { value } = deps({ 'Gastos 11/2026': [], 'Gastos 01/2027': [] })
  const result = await processTransactions(
    [tx('p', '2026-10-30', 'LOJA X', 100, { installmentNumber: 2, totalInstallments: 4, billDueDate: '2027-01-05' })],
    value
  )
  expect(result.items[0]).toMatchObject({ tab: 'Gastos 01/2027', description: 'LOJA X (2/4)', merchantKey: 'loja' })
})

test('a card source missing from the dropdown is reported, not written', async () => {
  const { value } = deps({ 'Gastos 11/2026': [] }, { optionsIn: async () => ({ sources: ['Nubank'], categories: CATEGORIES }) })
  const result = await processTransactions([tx('x', '2026-10-15', 'UBER', 10)], value)
  expect(result.items).toEqual([])
  expect(result.problems).toEqual(['A fonte "C6" não existe no dropdown de Gastos 11/2026.'])
})

import { expect, test } from 'bun:test'
import { toBankTransaction } from '../src/pluggy/source'
import type { PluggyTransaction } from '../src/pluggy/types'

const base: PluggyTransaction = {
  id: 'tx',
  accountId: 'acc',
  date: '2026-10-16T00:00:00.000Z',
  description: 'UBER *TRIP ',
  amount: 23.1,
  type: 'DEBIT',
  status: 'POSTED',
  category: 'Taxi and ride-hailing',
  creditCardMetadata: { billId: 'bill-nov', payeeMCC: 4121 }
}
const bills = new Map([['bill-nov', '2026-11-05T00:00:00.000Z']])

test('a card charge becomes a purchase on its bill', () => {
  expect(toBankTransaction(base, bills)).toEqual({
    id: 'tx',
    accountId: 'acc',
    date: '2026-10-16',
    description: 'UBER *TRIP',
    amount: 23.1,
    status: 'posted',
    kind: 'purchase',
    billDueDate: '2026-11-05',
    mcc: '4121',
    providerCategory: 'Taxi and ride-hailing'
  })
})

test('negative amounts are payments or refunds', () => {
  expect(toBankTransaction({ ...base, amount: -1240.5, description: 'PAGAMENTO DE FATURA' }, bills)).toMatchObject({ kind: 'bill_payment', amount: 1240.5 })
  expect(toBankTransaction({ ...base, amount: -35, description: 'ESTORNO LOJA X' }, bills)).toMatchObject({ kind: 'refund', amount: 35 })
  expect(toBankTransaction({ ...base, status: 'PENDING' }, bills)).toMatchObject({ status: 'pending' })
})

test('installments: the first one by purchase date, later ones by charge date', () => {
  const first = { ...base, creditCardMetadata: { installmentNumber: 1, totalInstallments: 4, purchaseDate: '2026-10-10T00:00:00.000Z' } }
  const later = { ...base, creditCardMetadata: { installmentNumber: 2, totalInstallments: 4, purchaseDate: '2026-10-10T00:00:00.000Z' } }
  expect(toBankTransaction(first, bills)).toMatchObject({ date: '2026-10-10', installment: { number: 1, total: 4 } })
  expect(toBankTransaction(later, bills)).toMatchObject({ date: '2026-10-16', installment: { number: 2, total: 4 } })
})

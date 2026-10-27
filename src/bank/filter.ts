import type { CardConfig } from './config'
import type { BankTransaction } from './source'

// What the import proposes: confirmed purchases on a configured credit card. Bill
// payments, refunds and pending transactions never reach the model or the sheet;
// pending ones come back once the bank confirms them.
export function importable(tx: BankTransaction, cards: CardConfig[]): boolean {
  return tx.status === 'posted' && tx.kind === 'purchase' && tx.amount > 0 && cards.some((card) => card.accountId === tx.accountId)
}

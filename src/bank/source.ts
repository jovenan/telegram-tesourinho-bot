// What the import needs from the bank, independent of the provider (Pluggy today).

export interface BankTransaction {
  id: string
  accountId: string
  // Purchase date, yyyy-mm-dd.
  date: string
  description: string
  // Always positive; `kind` says what it is.
  amount: number
  status: 'pending' | 'posted'
  kind: 'purchase' | 'bill_payment' | 'refund'
  // Due date of the bill the bank put the purchase on, yyyy-mm-dd, when known.
  billDueDate?: string
  installment?: { number: number; total: number }
  mcc?: string
  providerCategory?: string
}

export interface BankAccount {
  id: string
  name: string
  credit: boolean
}

export interface BankSnapshot {
  accounts: BankAccount[]
  transactions: BankTransaction[]
  // Connections that need the user (expired consent, login error); one line each.
  issues: string[]
}

export interface BankSource {
  // Credit card transactions dated on or after `since` (yyyy-mm-dd).
  fetch(since: string): Promise<BankSnapshot>
}

// Synthetic data for development (env BANK_SOURCE = "fake"): dates are relative to
// today, so the fixture always looks like a recent statement.
export interface FakeTransaction extends Omit<BankTransaction, 'date' | 'billDueDate'> {
  daysAgo: number
}

export class FakeBankSource implements BankSource {
  constructor(
    private readonly fixture: { accounts: BankAccount[]; transactions: FakeTransaction[] },
    private readonly now: () => Date = () => new Date()
  ) {}

  async fetch(since: string): Promise<BankSnapshot> {
    const transactions = this.fixture.transactions
      .map(({ daysAgo, ...tx }) => ({ ...tx, date: isoDate(new Date(this.now().getTime() - daysAgo * 86_400_000)) }))
      .filter((tx) => tx.date >= since)
    return { accounts: this.fixture.accounts, transactions, issues: [] }
  }
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

import type { BankAccount, BankSnapshot, BankSource, BankTransaction } from '../bank/source'
import type { PluggyClient } from './client'
import type { PluggyItem, PluggyTransaction } from './types'

// Item states that need the user to act in Meu Pluggy.
const BROKEN_STATUSES = new Set(['LOGIN_ERROR', 'OUTDATED', 'WAITING_USER_INPUT'])
const CONSENT_WARNING_DAYS = 7
const BILL_PAYMENT = /pagamento|pgto|pag fatura|payment/i

function issueOf(item: PluggyItem, now: Date): string | null {
  const name = item.connector?.name ?? 'Meu Pluggy'
  if (BROKEN_STATUSES.has(item.status)) return `A conexão ${name} precisa de atenção (${item.status}).`
  if (item.consentExpiresAt) {
    const days = (new Date(item.consentExpiresAt).getTime() - now.getTime()) / 86_400_000
    if (days < 0) return `O consentimento da conexão ${name} expirou.`
    if (days < CONSENT_WARNING_DAYS) return `O consentimento da conexão ${name} expira em ${Math.ceil(days)} dia(s).`
  }
  return null
}

export function toBankTransaction(tx: PluggyTransaction, billDueDates: Map<string, string>): BankTransaction {
  const card = tx.creditCardMetadata ?? {}
  const installment = card.totalInstallments && card.totalInstallments > 1 && card.installmentNumber ? { number: card.installmentNumber, total: card.totalInstallments } : undefined
  // The first installment (or a single purchase) is dated by the purchase; later
  // installments by when they were charged.
  const date = (installment && installment.number > 1 ? tx.date : (card.purchaseDate ?? tx.date)).slice(0, 10)
  const dueDate = card.billId ? billDueDates.get(card.billId) : undefined
  const kind = tx.amount > 0 ? 'purchase' : BILL_PAYMENT.test(tx.description) ? 'bill_payment' : 'refund'

  return {
    id: tx.id,
    accountId: tx.accountId,
    date,
    description: tx.description.trim(),
    amount: Math.abs(tx.amount),
    status: tx.status === 'POSTED' ? 'posted' : 'pending',
    kind,
    ...(dueDate ? { billDueDate: dueDate.slice(0, 10) } : {}),
    ...(installment ? { installment } : {}),
    ...(card.payeeMCC ? { mcc: String(card.payeeMCC) } : {}),
    ...(tx.category ? { providerCategory: tx.category } : {})
  }
}

// Reads the configured Meu Pluggy items. Only credit accounts listed in
// PLUGGY_ACCOUNTS have their transactions fetched; the others are just reported.
export class PluggySource implements BankSource {
  constructor(
    private readonly client: PluggyClient,
    private readonly itemIds: string[],
    private readonly cardAccountIds: string[],
    private readonly now: () => Date = () => new Date()
  ) {}

  async fetch(since: string): Promise<BankSnapshot> {
    const snapshot: BankSnapshot = { accounts: [], transactions: [], issues: [] }

    for (const itemId of this.itemIds) {
      const issue = issueOf(await this.client.item(itemId), this.now())
      if (issue) snapshot.issues.push(issue)

      const accounts = await this.client.accounts(itemId)
      snapshot.accounts.push(...accounts.map((a): BankAccount => ({ id: a.id, name: a.marketingName || a.name, credit: a.type === 'CREDIT' })))

      for (const account of accounts) {
        if (account.type !== 'CREDIT' || !this.cardAccountIds.includes(account.id)) continue
        const bills = new Map((await this.client.bills(account.id)).map((bill) => [bill.id, bill.dueDate]))
        const transactions = await this.client.transactions(account.id, since)
        snapshot.transactions.push(...transactions.map((tx) => toBankTransaction(tx, bills)))
      }
    }

    return snapshot
  }
}

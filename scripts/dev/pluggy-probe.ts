// Read-only look at the real Meu Pluggy connection, to check what the import will
// see before turning it on. Reads PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET and
// PLUGGY_ITEM_IDS from .dev.vars. Never writes anywhere.
//
//   bun scripts/dev/pluggy-probe.ts            summary: accounts, statuses, fields present
//   bun scripts/dev/pluggy-probe.ts --full     also lists each credit card transaction
//   bun scripts/dev/pluggy-probe.ts --days 60  look further back (default 40)
import { PluggyClient } from '../../src/pluggy/client'
import { toBankTransaction } from '../../src/pluggy/source'
import { loadDevVars } from './env'

const args = process.argv.slice(2)
const full = args.includes('--full')
const days = Number(args[args.indexOf('--days') + 1]) || 40

const vars = loadDevVars()
const itemIds = (vars.PLUGGY_ITEM_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean)
if (!vars.PLUGGY_CLIENT_ID || !vars.PLUGGY_CLIENT_SECRET || itemIds.length === 0) {
  console.error('Defina PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET e PLUGGY_ITEM_IDS no .dev.vars.')
  process.exit(1)
}

const client = new PluggyClient({ clientId: vars.PLUGGY_CLIENT_ID, clientSecret: vars.PLUGGY_CLIENT_SECRET })
const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
const count = <T>(items: T[], key: (item: T) => string) =>
  Object.entries(items.reduce<Record<string, number>>((acc, item) => ({ ...acc, [key(item)]: (acc[key(item)] ?? 0) + 1 }), {}))
    .map(([k, n]) => `${k}: ${n}`)
    .join(', ')

for (const itemId of itemIds) {
  const item = await client.item(itemId)
  console.log(`\n# item ${itemId}`)
  console.log(`  conector: ${item.connector?.name ?? '?'} · status: ${item.status} · execução: ${item.executionStatus ?? '-'}`)
  console.log(`  última atualização: ${item.lastUpdatedAt ?? '-'} · consentimento até: ${item.consentExpiresAt ?? '-'}`)

  for (const account of await client.accounts(itemId)) {
    console.log(`\n  ## conta ${account.id}`)
    console.log(`     ${account.marketingName || account.name} · ${account.type}/${account.subtype ?? '-'}`)
    if (account.type !== 'CREDIT') continue

    const bills = await client.bills(account.id)
    console.log(`     faturas: ${bills.length} · vencimentos: ${bills.map((b) => b.dueDate.slice(0, 10)).slice(-4).join(', ') || '-'}`)
    const billDue = new Map(bills.map((b) => [b.id, b.dueDate]))

    const raw = await client.transactions(account.id, since)
    const mapped = raw.map((tx) => toBankTransaction(tx, billDue))
    console.log(`     transações desde ${since}: ${raw.length}`)
    console.log(`     status: ${count(raw, (tx) => tx.status) || '-'}`)
    console.log(`     tipo (como o import entende): ${count(mapped, (tx) => tx.kind) || '-'}`)
    console.log(`     sinal × type: ${count(raw, (tx) => `${tx.amount >= 0 ? '+' : '-'}${tx.type}`) || '-'}`)
    console.log(`     com billId: ${raw.filter((tx) => tx.creditCardMetadata?.billId).length} · billId com fatura conhecida: ${mapped.filter((tx) => tx.billDueDate).length}`)
    console.log(`     com purchaseDate: ${raw.filter((tx) => tx.creditCardMetadata?.purchaseDate).length} · parceladas: ${mapped.filter((tx) => tx.installment).length}`)
    const pendingInstallments = mapped.filter((tx) => tx.status === 'pending' && tx.installment && tx.installment.number > 1).length
    console.log(`     parcelas futuras como PENDING: ${pendingInstallments}`)

    if (full) {
      for (const tx of mapped.sort((a, b) => a.date.localeCompare(b.date))) {
        const installment = tx.installment ? ` (${tx.installment.number}/${tx.installment.total})` : ''
        console.log(`     ${tx.date} · ${tx.status} · ${tx.kind} · R$ ${tx.amount.toFixed(2)} · fatura ${tx.billDueDate ?? '?'} · ${tx.description}${installment} · id ${tx.id}`)
      }
    }
  }
}

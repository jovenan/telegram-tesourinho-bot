import type { Expense, ExpenseOptions } from '../sheets/expenses'
import { parseIsoDay, targetMonth } from './bill'
import type { CardConfig } from './config'
import { ClaimCounter, matchExpense, signature, type MatchResult } from './match'
import { merchantKey, suggestCategory, type KnownCategory } from './rules'
import { normalize, sheetDate } from './text'
import type { CategorizeItem } from './categorize'

// A transaction waiting to be matched and proposed.
export interface PendingTx {
  id: string
  accountId: string
  date: string
  description: string
  amount: number
  billDueDate: string | null
  installmentNumber: number | null
  totalInstallments: number | null
  mcc: string | null
  providerCategory: string | null
}

// A transaction already settled: matched to a row or written by the import. Counts
// as a claim on rows with its signature and teaches categories.
export interface ResolvedTx {
  tab: string
  source: string
  amount: number
  merchantKey: string
  category: string | null
  state: 'in_sheet' | 'imported'
  updatedAt: number
}

export interface ProcessDeps {
  cards: CardConfig[]
  monthTabTitle(month: string): string
  hasTab(title: string): Promise<boolean>
  expensesIn(title: string): Promise<Expense[]>
  optionsIn(title: string): Promise<ExpenseOptions>
  resolved: ResolvedTx[]
  categorize(items: CategorizeItem[], categories: string[], examples: Array<{ description: string; category: string }>): Promise<Map<number, string>>
}

export interface BatchItem {
  id: string
  tab: string
  source: string
  // dd/mm/yyyy, as written in column C.
  date: string
  description: string
  value: number
  merchantKey: string
  suggestion: string | null
  suggestionKind: 'rule' | 'llm' | null
  duplicate: { row: number; description: string; date: string; value: number | null } | null
  // Bought on the closing day: may belong to the next bill.
  closingDay: boolean
}

export interface ProcessResult {
  items: BatchItem[]
  // Matched to a row; the row's category teaches the merchant's category.
  inSheet: Array<{ id: string; tab: string; source: string; merchantKey: string; row: number; category: string | null }>
  // Tabs that don't exist (or are hidden), with the transactions waiting for them.
  waiting: Map<string, string[]>
  // Category options per tab, kept with the batch for the review buttons.
  categories: Record<string, string[]>
  problems: string[]
}

function describe(tx: PendingTx): string {
  const base = tx.description.trim()
  return tx.totalInstallments && tx.totalInstallments > 1 && tx.installmentNumber
    ? `${base} (${tx.installmentNumber}/${tx.totalInstallments})`
    : base
}

// Matches new card purchases against the sheet and suggests categories. Nothing is
// written here; the result becomes the batch preview.
export async function processTransactions(pending: PendingTx[], deps: ProcessDeps): Promise<ProcessResult> {
  const result: ProcessResult = { items: [], inSheet: [], waiting: new Map(), categories: {}, problems: [] }
  const rowsCache = new Map<string, Promise<Expense[]>>()
  const optionsCache = new Map<string, Promise<ExpenseOptions>>()
  const rows = (tab: string) => (rowsCache.has(tab) ? rowsCache : rowsCache.set(tab, deps.expensesIn(tab))).get(tab)!
  const options = (tab: string) => (optionsCache.has(tab) ? optionsCache : optionsCache.set(tab, deps.optionsIn(tab))).get(tab)!
  const tabExists = new Map<string, Promise<boolean>>()
  const exists = (tab: string) => (tabExists.has(tab) ? tabExists : tabExists.set(tab, deps.hasTab(tab))).get(tab)!

  const claims = new ClaimCounter(deps.resolved.map((tx) => signature(tx.tab, tx.source, tx.amount)))
  const sorted = [...pending].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))

  for (const tx of sorted) {
    const card = deps.cards.find((candidate) => candidate.accountId === tx.accountId)
    const purchase = parseIsoDay(tx.date)
    if (!card || !purchase) continue

    const target = targetMonth(purchase, card, tx.billDueDate ? parseIsoDay(tx.billDueDate) : null)
    const tab = deps.monthTabTitle(target.month)
    if (!(await exists(tab))) {
      result.waiting.set(tab, [...(result.waiting.get(tab) ?? []), tx.id])
      continue
    }

    const { sources, categories } = await options(tab)
    result.categories[tab] = categories
    const source = sources.length === 0 ? card.source : sources.find((option) => normalize(option) === normalize(card.source))
    if (!source) {
      const problem = `A fonte "${card.source}" não existe no dropdown de ${tab}.`
      if (!result.problems.includes(problem)) result.problems.push(problem)
      continue
    }

    // On the closing day the purchase may sit in either bill's tab.
    const tabs = [tab, ...(target.alternative && (await exists(deps.monthTabTitle(target.alternative))) ? [deps.monthTabTitle(target.alternative)] : [])]
    let match: MatchResult = { kind: 'none' }
    let matchTab = tab
    for (const candidateTab of tabs) {
      const sig = signature(candidateTab, source, tx.amount)
      match = matchExpense({ tab: candidateTab, source, value: tx.amount, date: purchase }, await rows(candidateTab), claims.get(sig))
      matchTab = candidateTab
      if (match.kind !== 'none') break
    }

    const description = describe(tx)
    const key = merchantKey(description)
    if (match.kind === 'in_sheet') {
      claims.add(signature(matchTab, source, tx.amount))
      result.inSheet.push({ id: tx.id, tab: matchTab, source, merchantKey: key, row: match.row.row, category: match.row.category || null })
      continue
    }

    result.items.push({
      id: tx.id,
      tab: match.kind === 'maybe' ? matchTab : tab,
      source,
      date: sheetDate(purchase),
      description,
      value: tx.amount,
      merchantKey: key,
      suggestion: null,
      suggestionKind: null,
      duplicate: match.kind === 'maybe' ? { row: match.row.row, description: match.row.description, date: match.row.date, value: match.row.value } : null,
      closingDay: target.alternative !== undefined
    })
  }

  // Categories: what was already recorded for the same merchant (this batch's matches
  // are the newest), then the model.
  const known: KnownCategory[] = [
    ...deps.resolved.flatMap((tx) => (tx.category ? [{ key: tx.merchantKey, category: tx.category, at: tx.updatedAt }] : [])),
    ...result.inSheet.flatMap((tx) => (tx.category ? [{ key: tx.merchantKey, category: tx.category, at: Number.MAX_SAFE_INTEGER }] : []))
  ]
  for (const tab of rowsCache.keys()) {
    for (const row of await rows(tab)) {
      if (row.category) known.push({ key: merchantKey(row.description), category: row.category, at: 0 })
    }
  }

  const unknown: Array<{ item: BatchItem; idx: number }> = []
  result.items.forEach((item, idx) => {
    const fromRule = suggestCategory(item.merchantKey, known)
    const valid = fromRule && result.categories[item.tab]?.find((option) => normalize(option) === normalize(fromRule))
    if (valid) {
      item.suggestion = valid
      item.suggestionKind = 'rule'
    } else {
      unknown.push({ item, idx })
    }
  })

  if (unknown.length > 0) {
    const categories = [...new Set(unknown.flatMap(({ item }) => result.categories[item.tab] ?? []))]
    const pendingById = new Map(pending.map((tx) => [tx.id, tx]))
    const examples = deps.resolved
      .filter((tx) => tx.category)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((tx) => ({ description: tx.merchantKey, category: tx.category! }))
    const suggestions = await deps.categorize(
      unknown.map(({ item, idx }) => ({
        idx,
        description: item.description,
        value: item.value,
        mcc: pendingById.get(item.id)?.mcc ?? undefined,
        providerCategory: pendingById.get(item.id)?.providerCategory ?? undefined
      })),
      categories,
      examples
    )
    for (const { item, idx } of unknown) {
      const suggestion = suggestions.get(idx)
      if (suggestion && result.categories[item.tab]?.includes(suggestion)) {
        item.suggestion = suggestion
        item.suggestionKind = 'llm'
      }
    }
  }

  return result
}

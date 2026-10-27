import { normalize } from './text'

// Per credit card settings, from the PLUGGY_ACCOUNTS secret:
//   { "<accountId>": { "source": "C6", "dueDay": 5, "closingDaysBeforeDue": 7 } }
export interface CardConfig {
  accountId: string
  // Exact "Fonte de saida" option in the sheet.
  source: string
  // Day of the month the bill is due.
  dueDay: number
  // Calendar days between the bill closing and its due date (C6: 7).
  closingDaysBeforeDue: number
}

export function parseCards(json: string | undefined): CardConfig[] {
  if (!json?.trim()) return []
  try {
    const raw = JSON.parse(json) as Record<string, Partial<CardConfig>>
    return Object.entries(raw).flatMap(([accountId, card]) => {
      const valid =
        typeof card?.source === 'string' &&
        card.source.trim() !== '' &&
        Number.isInteger(card.dueDay) &&
        card.dueDay! >= 1 &&
        card.dueDay! <= 31 &&
        Number.isInteger(card.closingDaysBeforeDue) &&
        card.closingDaysBeforeDue! >= 1 &&
        card.closingDaysBeforeDue! <= 27
      if (!valid) {
        console.error(`PLUGGY_ACCOUNTS: invalid settings for account ${accountId}`)
        return []
      }
      return [{ accountId, source: card.source!.trim(), dueDay: card.dueDay!, closingDaysBeforeDue: card.closingDaysBeforeDue! }]
    })
  } catch {
    console.error('PLUGGY_ACCOUNTS is not valid JSON')
    return []
  }
}

// The card a "Fonte de saida" belongs to, so expenses typed in the chat follow the
// same bill rule as the import.
export function cardForSource(cards: CardConfig[], source: string): CardConfig | null {
  return cards.find((card) => normalize(card.source) === normalize(source)) ?? null
}

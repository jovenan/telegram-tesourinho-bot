// Category suggestions learned from what was already recorded: the category of the
// latest purchase at the same merchant, from imported transactions first and, for
// merchants never imported, from rows already in the sheet.

const STOPWORDS = new Set(['parc', 'parcela', 'compra', 'pagamento', 'pag', 'br', 'bra', 'com'])

// "IFD*RESTAURANTE XYZ 123" → "ifd restaurante xyz"; "UBER *TRIP" → "uber trip".
// Digits, punctuation and accents are dropped so store numbers and installment
// counters ("2/4") don't split one merchant into many.
export function merchantKey(description: string): string {
  const words = description
    .replace(/\s*-\s*AI GENERATED\s*$/i, '')
    .replace(/\(\d+\/\d+\)/g, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\d+/g, ' ')
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 2)
  // "pag" alone is the only hint for "PAG*JOSE": keep it when nothing else is left.
  const meaningful = words.filter((word) => !STOPWORDS.has(word))
  return (meaningful.length > 0 ? meaningful : words).slice(0, 3).join(' ')
}

export interface KnownCategory {
  key: string
  category: string
  // Larger is more recent.
  at: number
}

// Latest known category for a merchant, or null.
export function suggestCategory(key: string, known: KnownCategory[]): string | null {
  if (!key) return null
  let best: KnownCategory | null = null
  for (const entry of known) {
    if (entry.key === key && entry.category && (!best || entry.at > best.at)) best = entry
  }
  return best?.category ?? null
}

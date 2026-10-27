// Fields of the Pluggy API responses the import reads (https://docs.pluggy.ai).

export interface PluggyItem {
  id: string
  status: string
  executionStatus?: string | null
  consentExpiresAt?: string | null
  lastUpdatedAt?: string | null
  connector?: { name?: string } | null
  error?: { code?: string; message?: string } | null
}

export interface PluggyAccount {
  id: string
  itemId: string
  type: 'BANK' | 'CREDIT'
  subtype?: string
  name: string
  marketingName?: string | null
  number?: string | null
}

export interface PluggyTransaction {
  id: string
  accountId: string
  // Posted date (ISO).
  date: string
  description: string
  descriptionRaw?: string | null
  // Credit card accounts: positive = new charge, negative = payment or refund.
  amount: number
  type: 'DEBIT' | 'CREDIT'
  status: 'POSTED' | 'PENDING'
  category?: string | null
  creditCardMetadata?: {
    installmentNumber?: number | null
    totalInstallments?: number | null
    totalAmount?: number | null
    purchaseDate?: string | null
    payeeMCC?: number | string | null
    billId?: string | null
  } | null
}

export interface PluggyBill {
  id: string
  dueDate: string
  billClosingDate?: string | null
}

export interface PluggyPage<T> {
  results: T[]
  page?: number
  totalPages?: number
  // Cursor endpoints: ready-made query string for the next page, or null.
  next?: string | null
}

export type Effort = 'low' | 'medium' | 'high'

export const DEFAULT_MODEL = 'claude-sonnet-5-5'
// Offered when the monthly budget alert fires: ~20x cheaper than Sonnet 5.5.
export const BUDGET_MODEL = 'claude-haiku-5-5'
export const DEFAULT_EFFORT: Effort = 'medium'
export const DEFAULT_MONTHLY_BUDGET_USD = 15
export const BUDGET_ALERT_RATIO = 0.8

// One API call per step; a turn that needs more steps than this is stopped.
export const MAX_STEPS_PER_TURN = 15
export const MAX_OUTPUT_TOKENS = 16000
// Compact the history once a request carries more than this many tokens.
export const COMPACT_AT_TOKENS = 60_000

export const MODEL_NAMES: Record<string, string> = {
  'claude-sonnet-5-5': 'Sonnet 5.5',
  'claude-haiku-5-5': 'Haiku 5.5',
  'claude-opus-5-5': 'Opus 5.5'
}

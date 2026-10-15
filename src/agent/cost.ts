import type { UsageDelta } from '../db/stores/usage'
import type { Usage } from './types'

// USD per million tokens. Cache writes use the 5-minute TTL price.
interface Prices {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

const PRICES: Record<string, Prices> = {
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  // Prompts up to 100k tokens; longer prompts cost 5x (not expected in this bot).
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 }
}

type UsageLike = Pick<Usage, 'input_tokens' | 'output_tokens'> & {
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
  iterations?: Array<{ input_tokens?: number; output_tokens?: number }> | null
}

export function usageDelta(model: string, usage: UsageLike): UsageDelta {
  const prices = PRICES[model] ?? PRICES['claude-sonnet-5-5']

  // A compaction call reports zero at the top level and its real usage in iterations.
  const iterations = usage.iterations ?? []
  const fromIterations = usage.input_tokens === 0 && usage.output_tokens === 0 && iterations.length > 0
  const inputTokens = fromIterations ? iterations.reduce((n, it) => n + (it.input_tokens ?? 0), 0) : usage.input_tokens
  const outputTokens = fromIterations ? iterations.reduce((n, it) => n + (it.output_tokens ?? 0), 0) : usage.output_tokens
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0

  const costUsd =
    (inputTokens * prices.input +
      outputTokens * prices.output +
      cacheReadTokens * prices.cacheRead +
      cacheWriteTokens * prices.cacheWrite) /
    1_000_000

  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd }
}

export function formatUsd(value: number): string {
  return `US$ ${value.toFixed(2).replace('.', ',')}`
}

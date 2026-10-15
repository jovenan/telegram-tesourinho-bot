import { expect, test } from 'bun:test'
import { formatUsd, usageDelta } from '../src/agent/cost'

test('Sonnet 5.5 cost includes cache reads and writes', () => {
  const delta = usageDelta('claude-sonnet-5-5', {
    input_tokens: 1_000_000,
    output_tokens: 100_000,
    cache_read_input_tokens: 1_000_000,
    cache_creation_input_tokens: 1_000_000
  } as any)

  // 2 (input) + 1 (output) + 0.10 (cache read) + 2.50 (cache write)
  expect(delta.costUsd).toBeCloseTo(5.6)
  expect(delta.cacheReadTokens).toBe(1_000_000)
})

test('Haiku 5.5 is priced separately', () => {
  const delta = usageDelta('claude-haiku-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 } as any)
  expect(delta.costUsd).toBeCloseTo(0.6)
})

test('formatUsd', () => {
  expect(formatUsd(1.234)).toBe('US$ 1,23')
})

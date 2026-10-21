import { expect, test } from 'bun:test'
import { interruptedResults, lastUserInput, unresolvedToolUses } from '../src/agent/history'
import type { MessageParam } from '../src/agent/types'

const toolUse = (id: string) => ({ type: 'tool_use', id, name: 'x', input: {} }) as const

test('finds tool calls left without results', () => {
  const broken: MessageParam[] = [
    { role: 'user', content: 'oi' },
    { role: 'assistant', content: [{ type: 'text', text: 'vou ver' }, toolUse('a'), toolUse('b')] }
  ]
  expect(unresolvedToolUses(broken)).toEqual(['a', 'b'])
  expect(unresolvedToolUses([...broken, { role: 'user', content: interruptedResults(['a', 'b']) }])).toEqual([])
  expect(unresolvedToolUses([{ role: 'assistant', content: 'texto' }])).toEqual([])
})

test('lastUserInput skips tool results', () => {
  const messages: MessageParam[] = [
    { role: 'user', content: [{ type: 'text', text: '[qui] lança 30' }] },
    { role: 'assistant', content: [toolUse('a')] },
    { role: 'user', content: interruptedResults(['a']) }
  ]
  expect(lastUserInput(messages)).toEqual([{ type: 'text', text: '[qui] lança 30' }])
})

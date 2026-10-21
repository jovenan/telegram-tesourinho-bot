import { expect, test } from 'bun:test'
import { z } from 'zod'
import { applyWrite, defineTool, defineWriteTool, handleToolCall, toApiTool, ToolError, type ToolContext } from '../src/tools/registry'
import { TOOLS } from '../src/tools'

const echo = defineTool({
  name: 'echo',
  description: 'echo',
  kind: 'read',
  input: z.strictObject({ text: z.string(), fail: z.boolean().optional() }),
  async execute({ text, fail }) {
    if (fail) throw new ToolError('falhou de propósito')
    return text
  }
})

const logged: string[] = []
const save = defineWriteTool({
  name: 'save',
  description: 'save',
  kind: 'write',
  input: z.strictObject({ value: z.string() }),
  async prepare({ value }) {
    if (value === 'bad') throw new ToolError('valor ruim')
    return { plan: { value }, preview: `salvar ${value}` }
  },
  async apply(plan: { value: string }) {
    return { result: `salvo ${plan.value}`, log: { description: plan.value, undo: [] } }
  }
})

const ctx = { writes: { add: (description: string) => logged.push(description) } } as unknown as ToolContext
const call = (name: string, input: unknown) => ({ type: 'tool_use', id: 'toolu_1', name, input }) as any

test('every tool exposes a strict schema without $schema', () => {
  for (const tool of TOOLS) {
    const api = toApiTool(tool)
    expect(api.strict).toBe(true)
    expect(api.input_schema).not.toHaveProperty('$schema')
    expect(api.input_schema).toMatchObject({ type: 'object', additionalProperties: false })
    expect(JSON.stringify(api.input_schema)).not.toMatch(/"(minimum|maximum)"/)
  }
})

test('tool names are unique', () => {
  expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length)
})

test('read tools run immediately', async () => {
  expect(await handleToolCall([echo], call('echo', { text: 'oi' }), ctx)).toEqual({
    kind: 'result',
    result: { type: 'tool_result', tool_use_id: 'toolu_1', content: 'oi' }
  })
})

test('unknown tools, invalid input and ToolError become error results', async () => {
  for (const [name, input] of [
    ['nope', {}],
    ['echo', { text: 1 }],
    ['echo', { text: 'x', fail: true }],
    ['save', { value: 'bad' }]
  ] as const) {
    const outcome = await handleToolCall([echo, save], call(name, input), ctx)
    expect(outcome).toMatchObject({ kind: 'result', result: { is_error: true } })
  }
})

test('write tools wait for approval and log on apply', async () => {
  const outcome = await handleToolCall([save], call('save', { value: 'x' }), ctx)
  expect(outcome).toEqual({ kind: 'pending', write: { toolUseId: 'toolu_1', name: 'save', plan: { value: 'x' }, preview: 'salvar x' } })

  if (outcome.kind !== 'pending') throw new Error('expected pending')
  expect(await applyWrite([save], outcome.write, ctx)).toEqual({ type: 'tool_result', tool_use_id: 'toolu_1', content: 'salvo x' })
  expect(logged).toEqual(['x'])
})

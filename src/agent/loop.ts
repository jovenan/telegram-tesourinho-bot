import type Anthropic from '@anthropic-ai/sdk'
import { handleToolCall, toApiTool, type Tool, type ToolContext } from '../tools/registry'
import { requestCompaction, requestStep } from './claude'
import type { Effort } from './config'
import type { ContentBlockParam, MessageParam, PendingWrite, ToolResultBlockParam, ToolUseBlock, Usage } from './types'

export interface StepInput {
  client: Anthropic
  model: string
  effort: Effort
  system: string
  messages: MessageParam[]
  tools: Tool[]
  toolContext: ToolContext
}

export type StepOutcome =
  // The model called tools that already ran; append their results and run another step.
  | { kind: 'continue'; toolResults: MessageParam }
  // Some calls are writes: they wait for the user's approval. `results` holds the
  // calls that already finished (reads, rejected writes) in the same step.
  | { kind: 'approval'; results: ToolResultBlockParam[]; writes: PendingWrite[] }
  // The turn is over; `text` is what to send to the user.
  | { kind: 'reply'; text: string }
  | { kind: 'refusal' }

export interface StepResult {
  assistant: MessageParam
  usage: Usage
  // Tokens the next request will carry, to decide when to compact.
  contextTokens: number
  outcome: StepOutcome
}

// Runs one agent step: a single model call plus the tools it asked for. Persisting
// messages, scheduling the next step and talking to the user are the caller's job.
export async function runStep(input: StepInput): Promise<StepResult> {
  const response = await requestStep(input.client, {
    model: input.model,
    effort: input.effort,
    system: input.system,
    tools: input.tools.map(toApiTool),
    messages: input.messages
  })

  // Stored exactly as returned (thinking blocks included): history is append-only.
  const assistant: MessageParam = { role: 'assistant', content: response.content as ContentBlockParam[] }
  const usage = response.usage
  const contextTokens =
    usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + usage.output_tokens
  const base = { assistant, usage, contextTokens }

  if (response.stop_reason === 'refusal') return { ...base, outcome: { kind: 'refusal' } }

  const toolUses = response.content.filter((block): block is ToolUseBlock => block.type === 'tool_use')
  if (response.stop_reason === 'tool_use' && toolUses.length > 0) {
    const outcomes = await Promise.all(toolUses.map((block) => handleToolCall(input.tools, block, input.toolContext)))
    const results = outcomes.flatMap((o) => (o.kind === 'result' ? [o.result] : []))
    const writes = outcomes.flatMap((o) => (o.kind === 'pending' ? [o.write] : []))

    if (writes.length > 0) return { ...base, outcome: { kind: 'approval', results, writes } }
    // All results go back in a single user message, in the order they were requested.
    return { ...base, outcome: { kind: 'continue', toolResults: { role: 'user', content: results } } }
  }

  const text = response.content
    .filter((block): block is Anthropic.Beta.Messages.BetaTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n\n')
    .trim()

  return { ...base, outcome: { kind: 'reply', text } }
}

export interface CompactionResult {
  summary: MessageParam | null
  usage: Usage
}

// Returns the signed summary message, or null when the API produced none (the
// conversation then simply continues uncompacted).
export async function compact(input: Omit<StepInput, 'toolContext'>): Promise<CompactionResult> {
  const response = await requestCompaction(input.client, {
    model: input.model,
    effort: input.effort,
    system: input.system,
    tools: input.tools.map(toApiTool),
    messages: input.messages
  })

  const summary =
    response.stop_reason === 'compaction' ? { role: 'assistant' as const, content: response.content as ContentBlockParam[] } : null
  return { summary, usage: response.usage }
}

import type { ContentBlockParam, MessageParam, ToolResultBlockParam } from './types'

// Ids of tool calls in the last message that never got a result. The API requires
// every tool_use to be answered in the very next user message, so a step that died
// between saving the model's reply and saving the results breaks the conversation.
export function unresolvedToolUses(messages: MessageParam[]): string[] {
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant' || typeof last.content === 'string') return []
  return last.content.flatMap((block) => (block.type === 'tool_use' ? [block.id] : []))
}

export function interruptedResults(ids: string[]): ToolResultBlockParam[] {
  return ids.map((id) => ({
    type: 'tool_result',
    tool_use_id: id,
    content: 'Interrompido por uma falha antes de terminar. Nada foi feito; tente de novo se ainda fizer sentido.',
    is_error: true
  }))
}

// The parts of the last user turn worth carrying into a new conversation (what the
// user said or sent, not tool results).
export function lastUserInput(messages: MessageParam[]): ContentBlockParam[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'user') continue
    if (typeof message.content === 'string') return [{ type: 'text', text: message.content }]
    const input = message.content.filter((block) => block.type === 'text' || block.type === 'image' || block.type === 'document')
    if (input.length > 0) return input
  }
  return []
}

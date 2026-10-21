import Anthropic from '@anthropic-ai/sdk'
import { MAX_OUTPUT_TOKENS, type Effort } from './config'
import type { ApiTool, Message, MessageParam } from './types'

// Compaction on demand is beta; the header must also go on every request that
// carries a summary block, so it is sent on all of them.
const BETAS = ['compact-2026-09-04']

const COMPACTION_INSTRUCTIONS = `Resuma esta conversa em português para que o assistente financeiro possa continuá-la sem o histórico.
Preserve: valores e totais já consultados (com mês e aba), lançamentos feitos, alterados ou desfeitos nesta conversa, pedidos do usuário ainda em aberto, decisões e preferências que ele expressou, e o assunto atual.
Não chame ferramentas; responda apenas com o resumo.`

export interface StepRequest {
  model: string
  effort: Effort
  system: string
  tools: ApiTool[]
  messages: MessageParam[]
}

export function createClaude(apiKey: string): Anthropic {
  return new Anthropic({ apiKey })
}

// Thinking is left at the model default (adaptive). Top-level cache_control caches
// the whole prefix (tools → system → history) up to the last message.
export function requestStep(client: Anthropic, request: StepRequest): Promise<Message> {
  return client.beta.messages.create({
    model: request.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: request.system,
    tools: request.tools,
    messages: request.messages,
    output_config: { effort: request.effort },
    cache_control: { type: 'ephemeral' },
    betas: BETAS
  })
}

// Asks for a signed summary of the whole history. Same system and tools as the
// conversation, as the API requires for the summary to be usable.
export function requestCompaction(client: Anthropic, request: StepRequest): Promise<Message> {
  return client.beta.messages.create({
    model: request.model,
    max_tokens: 8000,
    system: request.system,
    tools: request.tools,
    messages: request.messages,
    output_config: { effort: request.effort },
    compaction: { type: 'summarize', instructions: COMPACTION_INSTRUCTIONS },
    betas: BETAS
  })
}

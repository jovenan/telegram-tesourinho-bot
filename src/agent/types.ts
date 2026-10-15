import type Anthropic from '@anthropic-ai/sdk'

// The agent uses the beta Messages API (compaction on demand is beta), so all
// message shapes come from the beta namespace.
export type MessageParam = Anthropic.Beta.Messages.BetaMessageParam
export type ContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam
export type ToolUseBlock = Anthropic.Beta.Messages.BetaToolUseBlock
export type ToolResultBlockParam = Anthropic.Beta.Messages.BetaToolResultBlockParam
export type ApiTool = Anthropic.Beta.Messages.BetaTool
export type Usage = Anthropic.Beta.Messages.BetaUsage
export type Message = Anthropic.Beta.Messages.BetaMessage

// A write the model asked for, waiting for the user's ✅/❌.
export interface PendingWrite {
  toolUseId: string
  name: string
  plan: unknown
  preview: string
}

// Everything needed to finish a step that stopped for approval: results of the
// tools that already ran in that step, and the writes still to run.
export interface PendingApproval {
  token: string
  messageId: number | null
  results: ToolResultBlockParam[]
  writes: PendingWrite[]
}

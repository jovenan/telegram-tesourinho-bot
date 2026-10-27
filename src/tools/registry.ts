import { z } from 'zod'
import type { ApiTool, PendingWrite, ToolResultBlockParam, ToolUseBlock } from '../agent/types'
import type { CardConfig } from '../bank/config'
import type { FileStore } from '../db/stores/files'
import type { MemoryStore } from '../db/stores/memories'
import type { WriteStore } from '../db/stores/writes'
import type { Spreadsheet } from '../sheets/expenses'
import { NotExpenseTabError, SheetNotFoundError, TabNotAllowedError } from '../sheets/expenses'
import { SheetsAccessBlockedError } from '../sheets/client'
import type { UndoOp } from '../sheets/undo'

export interface ToolContext {
  spreadsheet: Spreadsheet
  // Credit cards whose expenses go to the month their bill is due.
  cards: CardConfig[]
  memories: MemoryStore
  files: FileStore
  writes: WriteStore
  now: Date
}

interface BaseTool<Input extends z.ZodObject> {
  name: string
  description: string
  input: Input
}

// Runs immediately when the model calls it (reads, memory).
export interface ReadTool<Input extends z.ZodObject = z.ZodObject> extends BaseTool<Input> {
  kind: 'read'
  execute(input: z.infer<Input>, ctx: ToolContext): Promise<string>
}

export interface WriteResult {
  // What the model is told happened.
  result: string
  // Logged so the write can be undone; omit for writes that cannot be undone.
  log?: { description: string; undo: UndoOp[] }
}

// Needs the user's approval. `prepare` validates and builds a preview without
// touching the sheet; `apply` runs only after ✅, with the plan `prepare` returned.
export interface WriteTool<Input extends z.ZodObject = z.ZodObject, Plan = any> extends BaseTool<Input> {
  kind: 'write'
  prepare(input: z.infer<Input>, ctx: ToolContext): Promise<{ plan: Plan; preview: string }>
  apply(plan: Plan, ctx: ToolContext): Promise<WriteResult>
}

export type Tool = ReadTool<any> | WriteTool<any>

// Errors whose message is meant for the model (bad arguments, missing tab, ...).
export class ToolError extends Error {}

export function defineTool<Input extends z.ZodObject>(tool: ReadTool<Input>): ReadTool<Input> {
  return tool
}

export function defineWriteTool<Input extends z.ZodObject, Plan>(tool: WriteTool<Input, Plan>): WriteTool<Input, Plan> {
  return tool
}

// Strict tool schemas reject numeric bounds, which zod emits for every .int()
// (the safe-integer range). Bounds are still enforced when the input is parsed.
const UNSUPPORTED_KEYWORDS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']

function stripUnsupported(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripUnsupported)
  if (!node || typeof node !== 'object') return node
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => !UNSUPPORTED_KEYWORDS.includes(key))
      .map(([key, value]) => [key, stripUnsupported(value)])
  )
}

export function toApiTool(tool: Tool): ApiTool {
  const { $schema: _, ...schema } = stripUnsupported(z.toJSONSchema(tool.input)) as Record<string, unknown>
  return {
    name: tool.name,
    description: tool.description,
    input_schema: schema as ApiTool['input_schema'],
    strict: true
  }
}

// Fingerprint of the tool definitions. A conversation started with a different tool
// set cannot continue (Sonnet 5.5 rejects replayed thinking after a tools change).
export function toolsHash(tools: Tool[]): string {
  const text = JSON.stringify(tools.map(toApiTool))
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function toolResult(toolUseId: string, content: string, isError = false): ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id: toolUseId, content, ...(isError ? { is_error: true } : {}) }
}

function errorMessage(error: unknown, toolName: string): string {
  if (error instanceof ToolError || error instanceof SheetNotFoundError || error instanceof NotExpenseTabError || error instanceof TabNotAllowedError) {
    return error.message
  }
  // A tool reached past the tab rule: the client guard stopped it before any request.
  if (error instanceof SheetsAccessBlockedError) return 'Essa aba não está acessível: só as abas mensais "Gastos MM/AAAA" visíveis.'
  console.error(`Tool ${toolName} failed`, error)
  return `Erro ao executar ${toolName}: ${error instanceof Error ? error.message : String(error)}`
}

// Outcome of handling one tool call: a final result, or a write waiting for approval.
export type ToolCallOutcome = { kind: 'result'; result: ToolResultBlockParam } | { kind: 'pending'; write: PendingWrite }

export async function handleToolCall(tools: Tool[], block: ToolUseBlock, ctx: ToolContext): Promise<ToolCallOutcome> {
  const done = (content: string, isError = false): ToolCallOutcome => ({
    kind: 'result',
    result: toolResult(block.id, content, isError)
  })

  const tool = tools.find((candidate) => candidate.name === block.name)
  if (!tool) return done(`Ferramenta desconhecida: ${block.name}`, true)

  const parsed = tool.input.safeParse(block.input)
  if (!parsed.success) return done(`Argumentos inválidos: ${z.prettifyError(parsed.error)}`, true)

  try {
    if (tool.kind === 'read') return done(await tool.execute(parsed.data, ctx))

    const { plan, preview } = await tool.prepare(parsed.data, ctx)
    return { kind: 'pending', write: { toolUseId: block.id, name: tool.name, plan, preview } }
  } catch (error) {
    return done(errorMessage(error, block.name), true)
  }
}

// Runs an approved write and logs it for undo. Returns the tool result for the model.
export async function applyWrite(tools: Tool[], write: PendingWrite, ctx: ToolContext): Promise<ToolResultBlockParam> {
  const tool = tools.find((candidate) => candidate.name === write.name)
  if (!tool || tool.kind !== 'write') return toolResult(write.toolUseId, `Ferramenta desconhecida: ${write.name}`, true)

  try {
    const { result, log } = await tool.apply(write.plan, ctx)
    if (log) ctx.writes.add(log.description, log.undo)
    return toolResult(write.toolUseId, result)
  } catch (error) {
    return toolResult(write.toolUseId, errorMessage(error, write.name), true)
  }
}

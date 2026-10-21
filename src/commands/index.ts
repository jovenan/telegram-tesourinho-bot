import { CHAT_MESSAGES } from '../messages'

export interface CommandContext {
  firstName: string
  reply(html: string): Promise<void>
  newConversation(): Promise<void>
  cancel(): Promise<boolean>
  usageReport(): string
  memoriesReport(): string
}

// Handles slash commands. Returns false when the text is not a known command.
export async function runCommand(text: string, ctx: CommandContext): Promise<boolean> {
  const command = text.trim().split(/\s+/)[0].toLowerCase().replace(/@\w+$/, '')

  switch (command) {
    case '/start':
      await ctx.reply(CHAT_MESSAGES.welcome(ctx.firstName))
      return true
    case '/ajuda':
    case '/help':
      await ctx.reply(CHAT_MESSAGES.help)
      return true
    case '/novo':
      await ctx.newConversation()
      await ctx.reply(CHAT_MESSAGES.newConversation)
      return true
    case '/cancelar':
      if (!(await ctx.cancel())) await ctx.reply(CHAT_MESSAGES.nothingToCancel)
      return true
    case '/custo':
      await ctx.reply(ctx.usageReport())
      return true
    case '/memoria':
      await ctx.reply(ctx.memoriesReport())
      return true
    default:
      return false
  }
}

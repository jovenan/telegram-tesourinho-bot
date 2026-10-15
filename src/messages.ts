export const CHAT_MESSAGES = {
  welcome: (name: string) =>
    `Olá ${name}! 👋\n\n` +
    `Sou seu assistente de finanças. Pode conversar comigo normalmente: lançar gastos ("gastei 45 no iFood no C6"), ` +
    `mandar foto de comprovante ou extrato em CSV/PDF, perguntar quanto gastou, comparar meses.\n\n` +
    `Antes de mexer na planilha eu sempre mostro uma prévia para você aprovar.\n\n` +
    `Digite /ajuda para ver os comandos.`,

  help:
    `<b>Comandos</b>\n` +
    `/novo - Começar uma conversa nova (esquece o contexto, mantém as preferências)\n` +
    `/memoria - Preferências que guardei\n` +
    `/custo - Gasto com a IA neste mês\n` +
    `/cancelar - Interromper o que estiver em andamento\n` +
    `/ajuda - Esta mensagem\n\n` +
    `Fora isso, é só escrever, mandar foto (comprovante, extrato) ou arquivo CSV/PDF.\n` +
    `Para desfazer a última alteração, diga "desfaz".`,

  newConversation: '🆕 Conversa nova iniciada.',
  conversationReset: '🔄 O bot foi atualizado, então comecei uma conversa nova.',
  nothingToCancel: 'Não há nada em andamento.',
  canceled: '⏹️ Parei.',
  tooManySteps: '⚠️ Essa tarefa precisou de passos demais e eu parei no meio. Tente pedir de forma mais específica.',
  refusal: 'Não posso ajudar com isso.',
  emptyReply: '(sem resposta)',
  unsupported: 'Ainda não sei lidar com esse tipo de mensagem. Mande texto, foto, CSV ou PDF.',
  fileTooLarge: 'Esse arquivo é grande demais para mim (máximo ~1,3 MB). Se for imagem, mande como foto (comprimida); se for extrato, prefira CSV.',
  fileFailed: '❌ Não consegui baixar o arquivo. Tente mandar de novo.',
  internalError: '❌ Algo deu errado ao processar sua mensagem. Tente novamente.',
  apiError: '❌ Não consegui falar com a IA agora. Tente de novo em instantes; se persistir, use /novo.',

  approvalExpired: 'Essa confirmação expirou.',
  approved: '✅ <b>Feito</b>',
  approvedWithErrors: '⚠️ <b>Feito em parte</b> (veja a resposta abaixo)',
  rejected: '❌ <b>Cancelado</b>',
  revising: '✏️ <b>Ajustando…</b>',
  discarded: '❌ <b>Descartado</b>',

  memories: (items: string[]) =>
    items.length
      ? `🧠 <b>Preferências guardadas</b>\n\n${items.join('\n')}\n\nPara apagar uma, me diga o número.`
      : '🧠 Ainda não guardei nenhuma preferência. Diga algo como "lembra que Uber é sempre Transporte".',

  budgetAlert: (spent: string, budget: string, percent: number) =>
    `⚠️ <b>Atenção ao custo da IA</b>\n\n` +
    `Este mês já foram ${spent} de um teto de ${budget} (${percent}%). O que prefere fazer?`,
  budgetRaised: (budget: string) => `✅ Teto mensal aumentado para ${budget}.`,
  budgetModelSwitched: (model: string) => `✅ A partir de agora uso o ${model}, bem mais barato.`,
  budgetKept: '👍 Sigo como está.',

  usage: (args: { month: string; spent: string; budget: string; percent: number; requests: number; model: string }) =>
    `💰 <b>Custo da IA em ${args.month}</b>\n\n` +
    `${args.spent} de ${args.budget} (${args.percent}%)\n` +
    `${args.requests} chamadas · modelo ${args.model}`
}

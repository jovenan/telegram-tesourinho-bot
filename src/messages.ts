export const CHAT_MESSAGES = {
  welcome: (name: string) =>
    `Às suas ordens${name ? `, ${name}` : ''}. 🎩\n\n` +
    `Sou o Grana, seu mordomo financeiro. Cuido da planilha de gastos: o senhor pode me dizer o que gastou ` +
    `("gastei 45 no iFood no C6"), mandar foto de comprovante ou extrato em CSV/PDF, ou perguntar como andam as contas.\n\n` +
    `Nada é gravado sem que o senhor aprove a prévia.\n\n` +
    `Os comandos estão em /ajuda.`,

  help:
    `<b>Comandos</b>\n` +
    `/novo - Começar uma conversa nova (esquece o contexto, mantém as preferências)\n` +
    `/memoria - Preferências que guardei\n` +
    `/custo - Gasto com a IA neste mês\n` +
    `/cancelar - Interromper o que estiver em andamento\n` +
    `/ajuda - Esta mensagem\n\n` +
    `Fora isso, é só escrever, mandar foto (comprovante, extrato) ou arquivo CSV/PDF.\n` +
    `Para desfazer a última alteração, diga "desfaz".`,

  newConversation: '🆕 Pois não, começamos do zero.',
  conversationReset: '🔄 Fui atualizado, senhor, então começamos uma conversa nova.',
  historyReset: '🔄 Perdão, senhor, tive um problema com o histórico desta conversa; recomecei a partir da sua última mensagem.',
  nothingToCancel: 'Não há nada em andamento, senhor.',
  canceled: '⏹️ Como desejar, interrompi.',
  tooManySteps: '⚠️ Essa tarefa precisou de passos demais e eu parei no meio. Tente pedir de forma mais específica.',
  refusal: 'Não posso ajudar com isso.',
  emptyReply: '(sem resposta)',
  unsupported: 'Lamento, senhor, mas ainda não sei lidar com esse tipo de mensagem. Texto, foto, CSV ou PDF, por gentileza.',
  fileTooLarge: 'Esse arquivo é grande demais para mim (imagens até 5 MB, outros arquivos até 20 MB). Se for imagem, mande como foto (comprimida).',
  fileFailed: '❌ Não consegui baixar o arquivo. Tente mandar de novo.',
  internalError: '❌ Perdão, senhor, algo deu errado. Poderia tentar novamente?',
  apiError: '❌ Perdão, senhor, não consegui pensar agora. Tente de novo em instantes; se persistir, use /novo.',

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

export const MESSAGES = {
  welcome: (name: string) =>
    `Olá ${name}! 👋\n\n` +
    `Eu sou seu assistente de gastos.\n\n` +
    `<b>Comandos:</b>\n` +
    `/gasto - Registrar um gasto manualmente\n` +
    `/ai [texto] - Registrar gasto com IA\n` +
    `📷 Envie uma foto - Extrair gasto automaticamente\n` +
    `/cancelar - Cancelar operação atual`,

  newExpense: '💰 <b>Novo Gasto</b>\n\nQual a descrição do gasto?',

  sourcePrompt: (list: string) => `🏦 <b>Fonte de saída</b>\n\nDe onde saiu o dinheiro?\n\n${list}`,

  categoryPrompt: (list: string) => `📁 <b>Categoria</b>\n\nEscolha a categoria:\n\n${list}`,

  valuePrompt: '💵 <b>Valor</b>\n\nQual o valor? (ex: 29.90 ou 29,90)',

  confirmation: (description: string, source: string, category: string, value: string) =>
    `📋 <b>Confirme os dados:</b>\n\n` +
    `📝 Gasto: ${description}\n` +
    `🏦 Fonte: ${source}\n` +
    `📁 Categoria: ${category}\n` +
    `💵 Valor: ${value}\n\n` +
    `Está correto? (sim/não)`,

  success: '✅ Gasto registrado na planilha!\n\nDigite /gasto para adicionar outro.',
  error: '❌ Erro ao salvar na planilha. Tente novamente.',
  canceled: 'Operação cancelada. Digite /gasto para registrar um novo gasto.',
  restart: 'Ok, vamos recomeçar.\n\nQual a descrição do gasto?',
  invalidCommand: 'Digite /gasto para registrar um gasto.',
  invalidValue: 'Por favor, digite um valor válido (ex: 29.90 ou 29,90)',
  invalidConfirmation: 'Por favor, responda "sim" ou "não".',
  invalidNumber: (max: number) => `Por favor, digite um número válido (1-${max}).`
}

// Mensagens para o fluxo de IA
export const AI_MESSAGES = {
  processing: '🔄 Analisando sua compra...',

  foundMultiple: (count: number) => `📋 <b>Encontrei ${count} gastos!</b>\n\nVou mostrar um por um para você confirmar.`,

  result: (data: { description: string; source: string | null; category: string | null; value: number }, current?: number, total?: number) => {
    const formattedValue = data.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
    const header = total && total > 1
      ? `📋 <b>Gasto ${current}/${total}:</b>`
      : `📋 <b>Dados extraídos:</b>`
    return `${header}

📝 <b>Descrição:</b> ${data.description}
🏦 <b>Fonte:</b> ${data.source || '⚠️ Não identificada'}
📁 <b>Categoria:</b> ${data.category || '⚠️ Não identificada'}
💵 <b>Valor:</b> R$ ${formattedValue}`
  },

  resultWithAddOption: `

💡 <i>Para adicionar descrição, envie: add [texto]</i>`,

  allDone: (saved: number, total: number) =>
    `✅ Concluído! ${saved}/${total} gastos foram salvos.`,

  error: `❌ Não consegui extrair os dados automaticamente.

Use /gasto para cadastrar manualmente.`,

  missingFields: (fields: string[]) =>
    `⚠️ Não consegui identificar: ${fields.join(', ')}

Deseja continuar mesmo assim? (sim/não/editar)`,

  noContent: `❌ Envie uma foto de comprovante ou descreva o gasto.

Exemplos:
• Envie uma foto da nota fiscal
• Digite: /ai Almoço no restaurante 45,90 no débito`,

  editPrompt: `📝 Vamos ajustar os dados.

Qual a descrição do gasto?`
}

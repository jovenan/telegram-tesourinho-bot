export const MESSAGES = {
  welcome: (name: string) =>
    `Olá ${name}! 👋\n\n` +
    `Eu sou seu assistente de gastos.\n\n` +
    `<b>Comandos:</b>\n` +
    `/gasto - Registrar um gasto\n` +
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

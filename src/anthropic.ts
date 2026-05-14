import Anthropic from '@anthropic-ai/sdk'
import type { Env, ExpenseExtraction, TravelExpenseExtraction } from './types'

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

function normalizeMediaType(contentType: string): ImageMediaType {
  const type = contentType.split(';')[0].toLowerCase().trim()

  if (type === 'image/png') return 'image/png'
  if (type === 'image/gif') return 'image/gif'
  if (type === 'image/webp') return 'image/webp'
  return 'image/jpeg'
}

async function downloadImageAsBase64(url: string): Promise<{ data: string; mediaType: ImageMediaType }> {
  const response = await fetch(url)
  const buffer = await response.arrayBuffer()

  // Convert ArrayBuffer to base64 without using Node.js Buffer
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  const base64 = btoa(binary)

  const contentType = response.headers.get('content-type') || 'image/jpeg'
  const mediaType = normalizeMediaType(contentType)

  return { data: base64, mediaType }
}

const extractExpensesTool: Anthropic.Tool = {
  name: 'extract_expenses',
  description: 'Extrai informações de um ou mais gastos a partir de texto ou imagem de comprovante',
  input_schema: {
    type: 'object' as const,
    properties: {
      expenses: {
        type: 'array',
        description: 'Lista de gastos extraídos',
        items: {
          type: 'object',
          properties: {
            description: {
              type: 'string',
              description: 'SOMENTE o nome do estabelecimento como aparece na imagem. SEM prefixos como "Compra no débito", "Pagamento", "Transferência". Exemplos: "AGROPETHORSE SOROCABA", "UBER *TRIP", "IFOOD *IFOOD"'
            },
            category: {
              type: 'string',
              description: 'Categoria do gasto baseada na lista fornecida. Se não conseguir identificar, use null'
            },
            source: {
              type: 'string',
              description: 'Fonte/meio de pagamento baseado na lista fornecida. Se não conseguir identificar, use null'
            },
            value: {
              type: 'number',
              description: 'Valor numérico do gasto em reais (ex: 29.90). Extrair apenas o número, sem símbolo de moeda'
            }
          },
          required: ['description', 'value']
        }
      }
    },
    required: ['expenses']
  }
}

const extractTravelExpensesTool: Anthropic.Tool = {
  name: 'extract_travel_expenses',
  description: 'Extrai informações de um ou mais gastos de viagem a partir de texto ou imagem de comprovante',
  input_schema: {
    type: 'object' as const,
    properties: {
      expenses: {
        type: 'array',
        description: 'Lista de gastos de viagem extraídos',
        items: {
          type: 'object',
          properties: {
            date: {
              type: 'string',
              description: 'Data do gasto no formato YYYY-MM-DD. Se não conseguir identificar, use null'
            },
            country: {
              type: 'string',
              description: 'País do gasto em português. Se não conseguir identificar, use null'
            },
            city: {
              type: 'string',
              description: 'Cidade do gasto. Se não conseguir identificar, use null'
            },
            description: {
              type: 'string',
              description: 'SOMENTE o nome do estabelecimento como aparece na imagem. SEM prefixos como "Compra no débito", "Pagamento", "Recibo".'
            },
            category: {
              type: 'string',
              description: 'Categoria do gasto baseada na lista fornecida. Se não conseguir identificar, use null'
            },
            source: {
              type: 'string',
              description: 'Fonte/meio de pagamento baseado na lista fornecida. Se não conseguir identificar, use null'
            },
            value: {
              type: 'number',
              description: 'Valor numérico do gasto na moeda local, sem símbolo de moeda'
            }
          },
          required: ['description', 'value']
        }
      }
    },
    required: ['expenses']
  }
}

interface ExtractExpenseParams {
  env: Env
  imageUrl?: string
  text?: string
  categories: string[]
  sources: string[]
}

export async function extractExpenseData(params: ExtractExpenseParams): Promise<ExpenseExtraction[] | null> {
  const { env, imageUrl, text, categories, sources } = params

  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY
  })

  const content: Anthropic.MessageParam['content'] = []

  if (imageUrl) {
    const { data, mediaType } = await downloadImageAsBase64(imageUrl)
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data
      }
    })
  }

  const prompt = `Analise ${imageUrl ? 'esta imagem de comprovante/nota fiscal' : 'este texto'} e extraia as informações de TODOS os gastos presentes.

${text ? `Texto/descrição adicional do usuário: "${text}"` : ''}

CATEGORIAS FIXAS (use OBRIGATORIAMENTE uma destas):
- Mercado
- Restaurantes e Delivery
- Transporte
- Conta de Agua e Luz
- Moradia
- Internet e plano telefonico
- Assinaturas
- Saúde
- Lazer
- Educação
- Impostos
- Vestimentas
- Variados
- Viagem
- Presentes
- Pet
- Carro
- Investimentos

FONTES DE PAGAMENTO DISPONÍVEIS (use uma destas quando possível):
${sources.map((s) => `- ${s}`).join('\n')}

INSTRUÇÕES:
1. Identifique TODOS os gastos presentes na imagem/texto
2. Para cada gasto, extraia o VALOR exato (número em reais)
3. A DESCRIÇÃO deve ser SOMENTE o nome do estabelecimento/transação como aparece na imagem, SEM adicionar prefixos como "Compra no débito", "Pagamento", etc. Exemplos corretos: "AGROPETHORSE SOROCABA", "UBER *TRIP", "PAG*JoseDaSilva". Exemplos ERRADOS: "Compra no débito - AGROPETHORSE", "Pagamento via Pix - Loja X".
4. A CATEGORIA deve ser SEMPRE uma das categorias fixas listadas acima. Escolha a mais adequada.
5. Identifique a FONTE de pagamento da lista acima (se visível)
6. Se não conseguir identificar a fonte, retorne null. Para categoria, SEMPRE escolha uma das fixas.

Use a ferramenta extract_expenses para retornar os dados estruturados.`

  content.push({ type: 'text', text: prompt })

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      tools: [extractExpensesTool],
      tool_choice: { type: 'tool', name: 'extract_expenses' },
      messages: [{ role: 'user', content }]
    })

    const toolUseBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    )

    if (toolUseBlock) {
      const input = toolUseBlock.input as {
        expenses: Array<{
          description: string
          category?: string
          source?: string
          value: number
        }>
      }

      return input.expenses.map((expense) => ({
        description: expense.description,
        category: expense.category && expense.category !== 'null' ? expense.category : null,
        source: expense.source && expense.source !== 'null' ? expense.source : 'C6',
        value: expense.value
      }))
    }

    return null
  } catch (error) {
    console.error('Erro ao extrair dados com IA:', error)
    return null
  }
}

export async function extractTravelExpenseData(params: ExtractExpenseParams): Promise<TravelExpenseExtraction[] | null> {
  const { env, imageUrl, text, categories, sources } = params

  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY
  })

  const content: Anthropic.MessageParam['content'] = []

  if (imageUrl) {
    const { data, mediaType } = await downloadImageAsBase64(imageUrl)
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data
      }
    })
  }

  const prompt = `Analise ${imageUrl ? 'esta imagem de comprovante/nota fiscal de viagem' : 'este texto'} e extraia as informações de TODOS os gastos presentes.

${text ? `Texto/descrição adicional do usuário: "${text}"` : ''}

CATEGORIAS FIXAS (use OBRIGATORIAMENTE uma destas):
- Mercado
- Restaurantes e Delivery
- Transporte
- Conta de Agua e Luz
- Moradia
- Internet e plano telefonico
- Assinaturas
- Saúde
- Lazer
- Educação
- Impostos
- Vestimentas
- Variados
- Viagem
- Presentes
- Pet
- Carro
- Investimentos

FONTES DE PAGAMENTO DISPONÍVEIS (use uma destas quando possível):
${sources.map((s) => `- ${s}`).join('\n')}

INSTRUÇÕES:
1. Identifique TODOS os gastos presentes na imagem/texto
2. Para cada gasto, extraia o VALOR exato na moeda local, sem converter para reais
3. A DATA deve estar em YYYY-MM-DD. Se não estiver visível, retorne null
4. Identifique PAÍS e CIDADE quando aparecerem na imagem, endereço, estabelecimento ou texto adicional
5. A DESCRIÇÃO deve ser SOMENTE o nome do estabelecimento/transação como aparece na imagem, sem prefixos
6. A CATEGORIA deve ser SEMPRE uma das categorias fixas listadas acima. Escolha a mais adequada
7. Identifique a FONTE de pagamento da lista acima quando possível
8. Se não conseguir identificar fonte, país, cidade ou data, retorne null para o campo. Para categoria, SEMPRE escolha uma das fixas.

Use a ferramenta extract_travel_expenses para retornar os dados estruturados.`

  content.push({ type: 'text', text: prompt })

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      tools: [extractTravelExpensesTool],
      tool_choice: { type: 'tool', name: 'extract_travel_expenses' },
      messages: [{ role: 'user', content }]
    })

    const toolUseBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    )

    if (toolUseBlock) {
      const input = toolUseBlock.input as {
        expenses: Array<{
          date?: string
          country?: string
          city?: string
          description: string
          category?: string
          source?: string
          value: number
        }>
      }

      return input.expenses.map((expense) => ({
        date: expense.date && expense.date !== 'null' ? expense.date : null,
        country: expense.country && expense.country !== 'null' ? expense.country : null,
        city: expense.city && expense.city !== 'null' ? expense.city : null,
        description: expense.description,
        category: expense.category && expense.category !== 'null' ? expense.category : null,
        source: expense.source && expense.source !== 'null' ? expense.source : 'C6',
        value: expense.value
      }))
    }

    return null
  } catch (error) {
    console.error('Erro ao extrair dados de viagem com IA:', error)
    return null
  }
}

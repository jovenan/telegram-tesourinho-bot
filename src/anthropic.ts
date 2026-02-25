import Anthropic from '@anthropic-ai/sdk'
import type { ExpenseExtraction } from './types'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!
})

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
  const base64 = Buffer.from(buffer).toString('base64')

  const contentType = response.headers.get('content-type') || 'image/jpeg'
  const mediaType = normalizeMediaType(contentType)

  return { data: base64, mediaType }
}

const extractExpenseTool: Anthropic.Tool = {
  name: 'extract_expense',
  description: 'Extrai informações de um gasto a partir de texto ou imagem de comprovante',
  input_schema: {
    type: 'object' as const,
    properties: {
      description: {
        type: 'string',
        description: 'Descrição clara e concisa do gasto (ex: "Almoço no iFood", "Uber para o trabalho")'
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

interface ExtractExpenseParams {
  imageUrl?: string
  text?: string
  categories: string[]
  sources: string[]
}

export async function extractExpenseData(params: ExtractExpenseParams): Promise<ExpenseExtraction | null> {
  const { imageUrl, text, categories, sources } = params

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

  const prompt = `Analise ${imageUrl ? 'esta imagem de comprovante/nota fiscal' : 'este texto'} e extraia as informações do gasto.

${text ? `Texto/descrição adicional do usuário: "${text}"` : ''}

CATEGORIAS DISPONÍVEIS (use uma destas quando possível):
${categories.map((c) => `- ${c}`).join('\n')}

FONTES DE PAGAMENTO DISPONÍVEIS (use uma destas quando possível):
${sources.map((s) => `- ${s}`).join('\n')}

INSTRUÇÕES:
1. Extraia o VALOR exato do gasto (número em reais)
2. Crie uma DESCRIÇÃO clara e concisa
3. Escolha a CATEGORIA mais adequada da lista acima
4. Identifique a FONTE de pagamento da lista acima (se visível)
5. Se não conseguir identificar categoria ou fonte, retorne null para esses campos

Use a ferramenta extract_expense para retornar os dados estruturados.`

  content.push({ type: 'text', text: prompt })

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      tools: [extractExpenseTool],
      tool_choice: { type: 'tool', name: 'extract_expense' },
      messages: [{ role: 'user', content }]
    })

    const toolUseBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    )

    if (toolUseBlock) {
      const input = toolUseBlock.input as {
        description: string
        category?: string
        source?: string
        value: number
      }

      return {
        description: input.description,
        category: input.category && input.category !== 'null' ? input.category : null,
        source: input.source && input.source !== 'null' ? input.source : 'C6',
        value: input.value
      }
    }

    return null
  } catch (error) {
    console.error('Erro ao extrair dados com IA:', error)
    return null
  }
}

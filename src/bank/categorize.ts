import type Anthropic from '@anthropic-ai/sdk'
import type { Usage } from '../agent/types'

export interface CategorizeItem {
  idx: number
  description: string
  value: number
  mcc?: string
  providerCategory?: string
}

export interface CategorizeInput {
  items: CategorizeItem[]
  categories: string[]
  // The user's long-term preferences ("Uber é sempre Transporte").
  memories: string[]
  // Merchants already categorized, as hints ("IFD*RESTAURANTE → Restaurantes e Delivery").
  examples: Array<{ description: string; category: string }>
}

export interface CategorizeResult {
  suggestions: Map<number, string>
  usage: Usage | null
}

const MAX_EXAMPLES = 30

const SYSTEM = `Você classifica compras de cartão de crédito nas categorias da planilha de gastos de um usuário brasileiro.
Para cada compra, escolha a categoria mais provável entre as opções dadas, ou null quando o nome do estabelecimento não permitir saber (ex: maquininhas de pessoas, como "PAG*JOSEDASILVA").
Use as preferências do usuário e os exemplos já categorizados quando se aplicarem. O código MCC e a categoria do banco são só dicas.
Não invente: na dúvida, null.`

// One structured-output call for the whole batch: no tools, no history. Any failure
// leaves the items without a suggestion (the user picks the category).
export async function categorize(client: Anthropic, model: string, input: CategorizeInput): Promise<CategorizeResult> {
  if (input.items.length === 0 || input.categories.length === 0) return { suggestions: new Map(), usage: null }

  const schema = {
    type: 'object',
    properties: {
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            idx: { type: 'integer' },
            category: { anyOf: [{ type: 'string', enum: input.categories }, { type: 'null' }] }
          },
          required: ['idx', 'category'],
          additionalProperties: false
        }
      }
    },
    required: ['suggestions'],
    additionalProperties: false
  }

  const lines = input.items.map((item) =>
    [
      `${item.idx}. ${item.description}`,
      `R$ ${item.value.toFixed(2)}`,
      item.mcc ? `MCC ${item.mcc}` : '',
      item.providerCategory ? `banco: ${item.providerCategory}` : ''
    ]
      .filter(Boolean)
      .join(' · ')
  )
  const prompt = [
    `Categorias: ${input.categories.join(', ')}`,
    `Preferências do usuário:\n${input.memories.map((m) => `- ${m}`).join('\n') || '(nenhuma)'}`,
    `Exemplos já categorizados:\n${
      input.examples
        .slice(0, MAX_EXAMPLES)
        .map((e) => `- ${e.description} → ${e.category}`)
        .join('\n') || '(nenhum)'
    }`,
    `Compras:\n${lines.join('\n')}`
  ].join('\n\n')

  try {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      output_config: { format: { type: 'json_schema', schema } }
    })
    const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')
    const parsed = JSON.parse(text) as { suggestions?: Array<{ idx: number; category: string | null }> }

    const suggestions = new Map<number, string>()
    for (const { idx, category } of parsed.suggestions ?? []) {
      if (category && input.categories.includes(category) && input.items.some((item) => item.idx === idx)) suggestions.set(idx, category)
    }
    return { suggestions, usage: response.usage }
  } catch (error) {
    console.error('Categorization failed', error)
    return { suggestions: new Map(), usage: null }
  }
}

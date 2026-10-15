import { z } from 'zod'
import { defineTool, ToolError } from './registry'

export const remember = defineTool({
  name: 'remember',
  description:
    'Guarda uma preferência ou fato duradouro do usuário (ex: "Uber é sempre Transporte", "fonte padrão do mercado é Nubank"). Vale para conversas futuras. Use quando o usuário pedir para lembrar ou quando ele corrigir algo que deve valer sempre.',
  kind: 'read',
  input: z.strictObject({ text: z.string().describe('A preferência, em uma frase curta') }),
  async execute({ text }, { memories }) {
    const memory = memories.add(text.trim())
    return `Memória #${memory.id} guardada.`
  }
})

export const forget = defineTool({
  name: 'forget',
  description: 'Apaga uma memória pelo número (#id), quando o usuário pedir ou quando ela deixar de valer.',
  kind: 'read',
  input: z.strictObject({ id: z.number().int().describe('Número da memória') }),
  async execute({ id }, { memories }) {
    if (!memories.remove(id)) throw new ToolError(`Memória #${id} não existe.`)
    return `Memória #${id} apagada.`
  }
})

export const listMemories = defineTool({
  name: 'list_memories',
  description: 'Lista as memórias guardadas, com seus números.',
  kind: 'read',
  input: z.strictObject({}),
  async execute(_, { memories }) {
    const all = memories.list()
    return all.length ? all.map((m) => `#${m.id}: ${m.text}`).join('\n') : 'Nenhuma memória guardada.'
  }
})

import { describe, expect, test } from 'bun:test'
import { markdownToTelegramHtml, splitMessage } from '../src/telegram/format'

describe('markdownToTelegramHtml', () => {
  test('inline formatting', () => {
    expect(markdownToTelegramHtml('**R$ 10,00** e _itálico_ e `code`')).toBe('<b>R$ 10,00</b> e <i>itálico</i> e <code>code</code>')
  })

  test('escapes HTML', () => {
    expect(markdownToTelegramHtml('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d')
  })

  test('does not format inside code', () => {
    expect(markdownToTelegramHtml('`**x**`')).toBe('<code>**x**</code>')
  })

  test('bullets and headings', () => {
    expect(markdownToTelegramHtml('# Resumo\n- um\n* dois')).toBe('<b>Resumo</b>\n• um\n• dois')
  })

  test('code fences', () => {
    expect(markdownToTelegramHtml('```\na <b>\n```')).toBe('<pre>a &lt;b&gt;</pre>')
  })

  test('keeps underscores inside words', () => {
    expect(markdownToTelegramHtml('list_expenses e UBER *TRIP')).toBe('list_expenses e UBER *TRIP')
  })

  test('backslash escapes and asterisks inside bold', () => {
    expect(markdownToTelegramHtml('**UBER \\*TRIP**, de 05/11')).toBe('<b>UBER *TRIP</b>, de 05/11')
    expect(markdownToTelegramHtml('**R$ 10** e **R$ 20**')).toBe('<b>R$ 10</b> e <b>R$ 20</b>')
  })

  test('links', () => {
    expect(markdownToTelegramHtml('[site](https://x.com/a)')).toBe('<a href="https://x.com/a">site</a>')
  })
})

describe('splitMessage', () => {
  test('short text is one chunk', () => {
    expect(splitMessage('oi', 10)).toEqual(['oi'])
  })

  test('splits at paragraphs within the limit', () => {
    const chunks = splitMessage('aaaa\n\nbbbb\n\ncccc', 10)
    expect(chunks).toEqual(['aaaa\n\nbbbb', 'cccc'])
    expect(chunks.every((chunk) => chunk.length <= 10)).toBe(true)
  })

  test('hard-splits a line longer than the limit', () => {
    expect(splitMessage('x'.repeat(25), 10)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)])
  })
})

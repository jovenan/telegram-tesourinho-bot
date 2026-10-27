import { expect, test } from 'bun:test'
import { merchantKey, suggestCategory } from '../src/bank/rules'

test('merchant keys ignore numbers, punctuation, accents and the AI suffix', () => {
  expect(merchantKey('IFD*RESTAURANTE XYZ 123')).toBe('ifd restaurante xyz')
  expect(merchantKey('UBER *TRIP')).toBe('uber trip')
  expect(merchantKey('UBER* TRIP - AI GENERATED')).toBe('uber trip')
  expect(merchantKey('LOJA ÁGUA 2/4')).toBe('loja agua')
  expect(merchantKey('Fone (2/4)')).toBe('fone')
  expect(merchantKey('PAG*JOSEDASILVA')).toBe('josedasilva')
  expect(merchantKey('PAG*')).toBe('pag')
})

test('the latest known category wins', () => {
  const known = [
    { key: 'uber trip', category: 'Transporte', at: 1 },
    { key: 'uber trip', category: 'Lazer', at: 5 },
    { key: 'ifd restaurante', category: 'Restaurantes e Delivery', at: 3 }
  ]
  expect(suggestCategory('uber trip', known)).toBe('Lazer')
  expect(suggestCategory('cinemark', known)).toBeNull()
  expect(suggestCategory('', known)).toBeNull()
})

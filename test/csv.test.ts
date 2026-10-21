import { expect, test } from 'bun:test'
import { decodeText, parseCsv } from '../src/utils/csv'

test('comma CSV with quotes and CRLF', () => {
  expect(parseCsv('date,title,amount\r\n2026-10-01,"Padaria, Pão",12.5\r\n\r\n2026-10-02,"Diz ""oi""",3\r\n')).toEqual([
    ['date', 'title', 'amount'],
    ['2026-10-01', 'Padaria, Pão', '12.5'],
    ['2026-10-02', 'Diz "oi"', '3']
  ])
})

test('semicolon CSV with BOM', () => {
  expect(parseCsv('﻿Data;Descrição;Valor\n01/10/2026;Mercado;-12,50')).toEqual([
    ['Data', 'Descrição', 'Valor'],
    ['01/10/2026', 'Mercado', '-12,50']
  ])
})

test('decodes Windows-1252 when not valid UTF-8', () => {
  const latin1 = new Uint8Array([0x44, 0x65, 0x73, 0x63, 0x72, 0x69, 0xe7, 0xe3, 0x6f]) // "Descrição"
  expect(decodeText(latin1)).toBe('Descrição')
  expect(decodeText(new TextEncoder().encode('ação'))).toBe('ação')
})

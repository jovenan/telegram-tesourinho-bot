// Generates the fictional files used to test attachments with the chat CLI:
//   fixtures/extrato-nubank.csv  card statement export (date,title,amount)
//   fixtures/cupom.pdf           a store receipt as a text PDF
//   fixtures/cupom.jpg           the same receipt as a photo (macOS `sips`)
//
// Usage: bun scripts/dev/make-fixtures.ts
import { writeFileSync } from 'fs'
import { spawnSync } from 'child_process'

const dir = new URL('./fixtures/', import.meta.url)

writeFileSync(
  new URL('extrato-nubank.csv', dir),
  [
    'date,title,amount',
    '2026-10-03,Padaria Pao Quente,18.50',
    '2026-10-04,Spotify,21.90',
    '2026-10-06,Drogasil,42.17',
    '2026-10-07,Pagamento recebido,-850.00',
    '2026-10-08,Shell Box,180.00',
    '2026-10-09,Mercadolivre*Loja,89.90',
    '2026-10-10,Ifood *Ifood,37.80'
  ].join('\n') + '\n'
)

// Minimal single-page PDF with Helvetica text; offsets in the xref table are computed.
function textPdf(lines: string[]): string {
  const content = ['BT', '/F1 12 Tf', '50 760 Td', '16 TL', ...lines.map((line) => `(${line.replace(/[()\\]/g, '\\$&')}) '`), 'ET'].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 820] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return pdf
}

writeFileSync(
  new URL('cupom.pdf', dir),
  textPdf([
    'SUPERMERCADO BOM PRECO LTDA',
    'CNPJ 00.000.000/0001-00',
    'CUPOM FISCAL ELETRONICO - SAT',
    '14/10/2026 19:42',
    '----------------------------------------',
    'ARROZ 5KG               1 x 27,90   27,90',
    'FEIJAO 1KG              2 x  8,49   16,98',
    'LEITE INTEGRAL 1L       6 x  4,99   29,94',
    'CAFE 500G               1 x 18,90   18,90',
    '----------------------------------------',
    'TOTAL R$                            93,72',
    'CARTAO DE CREDITO NUBANK            93,72'
  ])
)

const photo = spawnSync('sips', ['-s', 'format', 'jpeg', new URL('cupom.pdf', dir).pathname, '--out', new URL('cupom.jpg', dir).pathname])
console.log(photo.status === 0 ? 'fixtures criadas (csv, pdf, jpg)' : 'fixtures criadas (csv, pdf); jpg requer macOS sips')

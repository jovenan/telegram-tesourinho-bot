const MESSAGE_LIMIT = 4096

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function formatInline(text: string): string {
  // Inline code and backslash escapes (\* \_ …) are set aside first so their
  // content is not formatted, then restored as literal text.
  const kept: string[] = []
  const keep = (value: string) => {
    kept.push(value)
    return `\u0000${kept.length - 1}\u0000`
  }

  let html = escapeHtml(text)
    .replace(/`([^`\n]+)`/g, (_, code: string) => keep(`<code>${code}</code>`))
    .replace(/\\([*_~`[\]()#\\-])/g, (_, char: string) => keep(char))

  html = html
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/__(.+?)__/g, '<b>$1</b>')
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, '$1<i>$2</i>')
    .replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, '$1<i>$2</i>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')

  return html.replace(/\u0000(\d+)\u0000/g, (_, i: string) => kept[Number(i)])
}

// Converts the simple markdown the model writes into Telegram's HTML subset
// (b, i, s, code, pre, a). Headings become bold lines, bullets become "•".
export function markdownToTelegramHtml(markdown: string): string {
  const output: string[] = []
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const fence = line.match(/^\s*```/)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        body.push(lines[i])
        i++
      }
      output.push(`<pre>${escapeHtml(body.join('\n'))}</pre>`)
      continue
    }

    const heading = line.match(/^\s*#{1,6}\s+(.*)$/)
    if (heading) {
      output.push(`<b>${formatInline(heading[1])}</b>`)
      continue
    }

    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/)
    if (bullet) {
      output.push(`${bullet[1]}• ${formatInline(bullet[2])}`)
      continue
    }

    output.push(formatInline(line))
  }

  return output.join('\n').trim()
}

// Splits text into chunks within Telegram's limit, preferring paragraph, then line
// boundaries, so HTML tags (which never span lines here) are not cut in half.
export function splitMessage(text: string, limit = MESSAGE_LIMIT): string[] {
  if (text.length <= limit) return [text]

  const chunks: string[] = []
  let current = ''

  const push = (piece: string, separator: string) => {
    if (!current) {
      current = piece
    } else if (current.length + separator.length + piece.length <= limit) {
      current += separator + piece
    } else {
      chunks.push(current)
      current = piece
    }
  }

  for (const paragraph of text.split('\n\n')) {
    if (paragraph.length <= limit) {
      push(paragraph, '\n\n')
      continue
    }
    for (const line of paragraph.split('\n')) {
      for (let start = 0; start < line.length; start += limit) {
        push(line.slice(start, start + limit), '\n')
      }
    }
  }

  if (current) chunks.push(current)
  return chunks
}

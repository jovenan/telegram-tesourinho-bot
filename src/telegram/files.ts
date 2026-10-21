import type { Api } from 'grammy'

// Attachments are sent inline (base64) and stored in the conversation history, whose
// rows live in Durable Object SQLite (max 2 MB per value). Base64 grows files by a
// third, so anything above this is refused.
const MAX_INLINE_FILE_BYTES = 1_300_000

export class FileTooLargeError extends Error {}

export async function downloadFile(api: Api, token: string, fileId: string, apiRoot = 'https://api.telegram.org'): Promise<{ bytes: Uint8Array; path: string }> {
  const file = await api.getFile(fileId)
  if (!file.file_path) throw new Error(`Telegram did not return a path for file ${fileId}`)
  if (file.file_size && file.file_size > MAX_INLINE_FILE_BYTES) throw new FileTooLargeError()

  const response = await fetch(`${apiRoot}/file/bot${token}/${file.file_path}`)
  if (!response.ok) throw new Error(`File download failed: ${response.status}`)

  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_INLINE_FILE_BYTES) throw new FileTooLargeError()
  return { bytes, path: file.file_path }
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

export function imageMediaType(mimeOrPath: string): ImageMediaType | null {
  const value = mimeOrPath.toLowerCase()
  if (value.includes('png')) return 'image/png'
  if (value.includes('gif')) return 'image/gif'
  if (value.includes('webp')) return 'image/webp'
  if (value.includes('jpeg') || value.includes('jpg')) return 'image/jpeg'
  return null
}

// Detects the image format from its first bytes (Telegram photos are JPEG, but
// documents can be anything).
export function sniffImageType(bytes: Uint8Array): ImageMediaType | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return null
}

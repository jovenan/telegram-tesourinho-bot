import { BOT_TOKEN } from './config'

interface TelegramFile {
  ok: boolean
  result: {
    file_id: string
    file_unique_id: string
    file_size: number
    file_path: string
  }
}

export async function getFileUrl(fileId: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`
    )

    const data: TelegramFile = await response.json()

    if (!data.ok || !data.result.file_path) {
      console.error('Erro ao obter arquivo:', data)
      return null
    }

    return `https://api.telegram.org/file/bot${BOT_TOKEN}/${data.result.file_path}`
  } catch (error) {
    console.error('Erro ao obter URL do arquivo:', error)
    return null
  }
}

export function getBestPhotoFileId(photos: { file_id: string; width: number; height: number }[]): string {
  const sorted = [...photos].sort((a, b) => (b.width * b.height) - (a.width * a.height))
  return sorted[0].file_id
}

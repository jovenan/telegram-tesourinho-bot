import type { Conversation, ConversationStore } from './db/stores/conversations'
import type { FileStore } from './db/stores/files'
import type { InboxStore } from './db/stores/inbox'
import type { JobStore } from './db/stores/jobs'
import type { UploadStore } from './db/stores/uploads'
import type { WriteStore } from './db/stores/writes'
import type { MessageParam } from './agent/types'

const DAY_MS = 24 * 60 * 60_000

// How long each kind of record is kept. Everything here is either already processed
// or no longer sent to the model; the card import history is kept for good.
export const RETENTION_DAYS = {
  inbox: 7,
  files: 30,
  jobs: 30,
  writes: 90,
  conversations: 90
}

// An upload is linked to its message right after it is made; the grace period keeps
// a file whose message is still being saved from being deleted.
const UPLOAD_GRACE_MS = 60 * 60_000
// Each delete is a subrequest; the rest waits for the next run.
export const MAX_FILE_DELETES_PER_RUN = 40

// Ids of Files API files referenced anywhere in the messages (image and document
// blocks, including ones nested in tool results).
export function fileIdsIn(messages: MessageParam[]): Set<string> {
  const ids = new Set<string>()
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit)
    } else if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>
      if (record.type === 'file' && typeof record.file_id === 'string') ids.add(record.file_id)
      Object.values(record).forEach(visit)
    }
  }
  messages.forEach((message) => visit(message.content))
  return ids
}

// Files to delete now: not referenced by the active history, capped per run.
export function filesToDelete(live: string[], referenced: Set<string>): { now: string[]; more: boolean } {
  const unused = live.filter((id) => !referenced.has(id))
  return { now: unused.slice(0, MAX_FILE_DELETES_PER_RUN), more: unused.length > MAX_FILE_DELETES_PER_RUN }
}

export interface MaintenanceDeps {
  inbox: InboxStore
  files: FileStore
  jobs: JobStore
  writes: WriteStore
  conversations: ConversationStore
  uploads: UploadStore
  current: Conversation | null
  deleteFile(fileId: string): Promise<boolean>
  now: number
}

// Returns true when files are left to delete (the caller queues another run).
export async function runMaintenance(deps: MaintenanceDeps): Promise<boolean> {
  const { now } = deps
  const before = (days: number) => now - days * DAY_MS

  deps.inbox.deleteProcessedBefore(before(RETENTION_DAYS.inbox))
  deps.files.deleteBefore(before(RETENTION_DAYS.files))
  deps.jobs.deleteProcessedBefore(before(RETENTION_DAYS.jobs))
  deps.writes.deleteBefore(before(RETENTION_DAYS.writes))
  deps.conversations.deleteOldConversations(deps.current?.id ?? null, before(RETENTION_DAYS.conversations))
  if (deps.current) deps.conversations.deleteCompacted(deps.current)

  // Only the current conversation's active history is ever sent again; files of
  // anything else (other conversations, messages before a summary) can go.
  const referenced = deps.current ? fileIdsIn(deps.conversations.messages(deps.current)) : new Set<string>()
  const { now: toDelete, more } = filesToDelete(deps.uploads.liveBefore(now - UPLOAD_GRACE_MS), referenced)

  const deleted: string[] = []
  for (const fileId of toDelete) {
    if (await deps.deleteFile(fileId)) deleted.push(fileId)
  }
  deps.uploads.markDeleted(deleted)
  return more
}

import { expect, test } from 'bun:test'
import { fileIdsIn, filesToDelete, MAX_FILE_DELETES_PER_RUN, runMaintenance, type MaintenanceDeps } from '../src/maintenance'
import type { MessageParam } from '../src/agent/types'

const history: MessageParam[] = [
  {
    role: 'user',
    content: [
      { type: 'image', source: { type: 'file', file_id: 'file_photo' } },
      { type: 'text', text: '[qui] foto' }
    ]
  },
  { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
  {
    role: 'user',
    content: [
      { type: 'document', source: { type: 'file', file_id: 'file_pdf' }, title: 'fatura.pdf' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }
    ]
  }
]

test('fileIdsIn finds Files API references only', () => {
  expect([...fileIdsIn(history)].sort()).toEqual(['file_pdf', 'file_photo'])
  expect(fileIdsIn([{ role: 'user', content: 'texto' }]).size).toBe(0)
})

test('files referenced by the active history are never deleted', () => {
  const plan = filesToDelete(['file_photo', 'file_old', 'file_pdf'], fileIdsIn(history))
  expect(plan).toEqual({ now: ['file_old'], more: false })
})

test('deletions are capped per run', () => {
  const live = Array.from({ length: MAX_FILE_DELETES_PER_RUN + 5 }, (_, i) => `file_${i}`)
  const plan = filesToDelete(live, new Set())
  expect(plan.now).toHaveLength(MAX_FILE_DELETES_PER_RUN)
  expect(plan.more).toBe(true)
})

test('runMaintenance applies the retentions and keeps the current conversation', async () => {
  const calls: string[] = []
  const now = Date.UTC(2026, 9, 26)
  const days = (n: number) => now - n * 24 * 60 * 60_000
  const record = (name: string) => (before: number) => calls.push(`${name} ${(now - before) / (24 * 60 * 60_000)}d`)
  const current = { id: 7, startedAt: days(200), systemPrompt: '', toolsHash: '', summaryMessageId: 50 }
  const deleted: string[] = []

  const deps = {
    inbox: { deleteProcessedBefore: record('inbox') },
    files: { deleteBefore: record('files') },
    jobs: { deleteProcessedBefore: record('jobs') },
    writes: { deleteBefore: record('writes') },
    conversations: {
      deleteOldConversations: (keep: number | null, before: number) => calls.push(`conversations keep ${keep} ${(now - before) / (24 * 60 * 60_000)}d`),
      deleteCompacted: (conversation: { id: number }) => calls.push(`compacted ${conversation.id}`),
      messages: () => history
    },
    uploads: { liveBefore: () => ['file_photo', 'file_gone', 'file_stuck'], markDeleted: (ids: string[]) => deleted.push(...ids) },
    current,
    deleteFile: async (id: string) => id !== 'file_stuck',
    now
  } as unknown as MaintenanceDeps

  expect(await runMaintenance(deps)).toBe(false)
  expect(calls).toEqual(['inbox 7d', 'files 30d', 'jobs 30d', 'writes 90d', 'conversations keep 7 90d', 'compacted 7'])
  // file_photo is still in the history; file_stuck failed and is retried next time.
  expect(deleted).toEqual(['file_gone'])
})

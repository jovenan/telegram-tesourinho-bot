import { eq } from 'drizzle-orm'
import type { Db } from '..'
import { settings } from '../schema'

export type SettingKey = (typeof settings.$inferSelect)['key']

export class SettingsStore {
  constructor(private readonly db: Db) {}

  get(key: SettingKey): string | null {
    return this.db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get()?.value ?? null
  }

  set(key: SettingKey, value: string): void {
    this.db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run()
  }
}

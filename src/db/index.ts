import { drizzle, type DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'
import { migrate } from 'drizzle-orm/durable-sqlite/migrator'
import migrations from './migrations/migrations'
import * as schema from './schema'

export type Db = DrizzleSqliteDODatabase<typeof schema>

export function createDb(storage: DurableObjectStorage): Db {
  return drizzle(storage, { schema })
}

// Must finish before the Durable Object serves any request (run it inside
// blockConcurrencyWhile).
export async function prepareDb(db: Db): Promise<void> {
  await migrate(db, migrations)
  db.insert(schema.runState).values({ id: 1, status: 'idle' }).onConflictDoNothing().run()
}

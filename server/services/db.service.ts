import { Context, Effect } from 'effect'
import type { db as hubDb } from '@nuxthub/db'
import type { BatchItem } from 'drizzle-orm/batch'

export type AtomicDbStatement = BatchItem<'sqlite'>
export type AtomicDbStatements = readonly [AtomicDbStatement, ...AtomicDbStatement[]]

export interface DbServiceInterface {
  readonly db: typeof hubDb
  readonly executeAtomic: (
    buildStatements: (database: typeof hubDb) => AtomicDbStatements
  ) => Promise<void>
}

export class DbService extends Context.Tag('DbService')<DbService, DbServiceInterface>() { }

export const getDb = Effect.map(DbService, service => service.db)

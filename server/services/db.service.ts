import { Context, Effect } from 'effect'
import type { db as hubDb } from '@nuxthub/db'

export interface DbServiceInterface {
  readonly db: typeof hubDb
}

export class DbService extends Context.Tag('DbService')<DbService, DbServiceInterface>() { }

export const getDb = Effect.map(DbService, service => service.db)

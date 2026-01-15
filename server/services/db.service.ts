import { Context, Effect, Layer } from 'effect'
import { db } from 'hub:db'

// Service interface
export interface DbServiceInterface {
  readonly db: typeof db
}

// Service tag
export class DbService extends Context.Tag('DbService')<DbService, DbServiceInterface>() { }

// Live implementation
export const DbServiceLive = Layer.sync(DbService, () => ({
  db
}))

// Helper to get the database instance
export const getDb = Effect.map(DbService, service => service.db)

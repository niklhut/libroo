import { Context, Effect, Layer } from 'effect'
import { useDrizzle, type DrizzleDB } from '../utils/drizzle'

// Service interface
export interface DbServiceInterface {
  readonly db: DrizzleDB
}

// Service tag
export class DbService extends Context.Tag('DbService')<DbService, DbServiceInterface>() { }

// Live implementation
export const DbServiceLive = Layer.sync(DbService, () => ({
  db: useDrizzle()
}))

// Helper to get the database instance
export const getDb = Effect.map(DbService, (service) => service.db)

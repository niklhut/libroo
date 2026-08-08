import { Context, Effect, Layer } from 'effect'
import { count, eq, isNull } from 'drizzle-orm'
import { books, loans, locations, tags, user, userBooks } from 'hub:db:schema'
import { DbService } from '../services/db.service'
import { DatabaseError } from './book.repository'

export interface MetricsRepositoryInterface {
  countUsers: () => Effect.Effect<number, DatabaseError, DbService>
  countCanonicalBooks: () => Effect.Effect<number, DatabaseError, DbService>
  countActiveUserBooks: () => Effect.Effect<number, DatabaseError, DbService>
  countActiveLoans: () => Effect.Effect<number, DatabaseError, DbService>
  countLocations: () => Effect.Effect<number, DatabaseError, DbService>
  countTags: () => Effect.Effect<number, DatabaseError, DbService>
}

export class MetricsRepository extends Context.Tag('MetricsRepository')<MetricsRepository, MetricsRepositoryInterface>() { }

export const MetricsRepositoryLive = Layer.effect(
  MetricsRepository,
  Effect.gen(function* () {
    const dbService = yield* DbService
    const countRows = (operation: string, query: () => Promise<Array<{ value: number }>>) =>
      Effect.tryPromise({
        try: async () => Number((await query())[0]?.value ?? 0),
        catch: error => new DatabaseError({ message: `Failed to ${operation}: ${error}`, operation })
      })

    return {
      countUsers: () => countRows('metrics.countUsers', () => dbService.db.select({ value: count() }).from(user)),
      countCanonicalBooks: () => countRows('metrics.countCanonicalBooks', () => dbService.db.select({ value: count() }).from(books)),
      countActiveUserBooks: () => countRows('metrics.countActiveUserBooks', () => dbService.db.select({ value: count() }).from(userBooks).where(isNull(userBooks.removedAt))),
      countActiveLoans: () => countRows('metrics.countActiveLoans', () => dbService.db.select({ value: count() }).from(loans).where(eq(loans.status, 'active'))),
      countLocations: () => countRows('metrics.countLocations', () => dbService.db.select({ value: count() }).from(locations)),
      countTags: () => countRows('metrics.countTags', () => dbService.db.select({ value: count() }).from(tags))
    }
  })
)

import { Context, Data, Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { userPreferences } from 'hub:db:schema'
import { DbService } from '../services/db.service'
import type { LibraryState } from '../../shared/types/book'

export interface UserPreferences {
  userId: string
  defaultLibraryStateFilter: LibraryState[]
  createdAt: Date
  updatedAt: Date
}

export class PreferencesError extends Data.TaggedError('PreferencesError')<{
  message: string
  operation: string
}> { }

export interface PreferencesRepositoryInterface {
  getPreferences: (userId: string) => Effect.Effect<UserPreferences | null, PreferencesError, DbService>
  upsertPreferences: (userId: string, defaultLibraryStateFilter: LibraryState[]) => Effect.Effect<UserPreferences, PreferencesError, DbService>
}

export class PreferencesRepository extends Context.Tag('PreferencesRepository')<PreferencesRepository, PreferencesRepositoryInterface>() { }

const normalizeStoredFilter = (value: unknown): LibraryState[] => {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is LibraryState =>
    item === 'owned' || item === 'wishlisted' || item === 'previously_owned'
  )
}

export const PreferencesRepositoryLive = Layer.effect(
  PreferencesRepository,
  Effect.gen(function* () {
    const dbService = yield* DbService

    const toModel = (row: typeof userPreferences.$inferSelect): UserPreferences => ({
      userId: row.userId,
      defaultLibraryStateFilter: normalizeStoredFilter(row.defaultLibraryStateFilter),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    })

    return {
      getPreferences: userId =>
        Effect.gen(function* () {
          const rows = yield* Effect.tryPromise({
            try: () => dbService.db
              .select()
              .from(userPreferences)
              .where(eq(userPreferences.userId, userId))
              .limit(1),
            catch: error => new PreferencesError({
              message: `Failed to load preferences: ${error}`,
              operation: 'getPreferences'
            })
          })

          return rows[0] ? toModel(rows[0]) : null
        }),

      upsertPreferences: (userId, defaultLibraryStateFilter) =>
        Effect.gen(function* () {
          const now = new Date()
          const rows = yield* Effect.tryPromise({
            try: () => dbService.db
              .insert(userPreferences)
              .values({
                userId,
                defaultLibraryStateFilter,
                createdAt: now,
                updatedAt: now
              })
              .onConflictDoUpdate({
                target: userPreferences.userId,
                set: {
                  defaultLibraryStateFilter,
                  updatedAt: now
                }
              })
              .returning(),
            catch: error => new PreferencesError({
              message: `Failed to save preferences: ${error}`,
              operation: 'upsertPreferences'
            })
          })

          const row = rows[0]
          if (!row) {
            return yield* Effect.fail(new PreferencesError({
              message: 'Preferences were not returned after save',
              operation: 'upsertPreferences.returning'
            }))
          }

          return toModel(row)
        })
    }
  })
)

export const getPreferences = (userId: string) =>
  Effect.flatMap(PreferencesRepository, repo => repo.getPreferences(userId))

export const upsertPreferences = (userId: string, defaultLibraryStateFilter: LibraryState[]) =>
  Effect.flatMap(PreferencesRepository, repo => repo.upsertPreferences(userId, defaultLibraryStateFilter))

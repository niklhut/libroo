import { Context, Data, Effect, Layer } from 'effect'
import { preferencesSchema } from '../../shared/utils/schemas'
import type { LibraryState } from '../../shared/types/book'
import { DEFAULT_LIBRARY_STATE_FILTER } from '../../shared/utils/library-query'
import { PreferencesRepository } from '../repositories/preferences.repository'
import type { PreferencesError } from '../repositories/preferences.repository'
import type { DbService } from './db.service'

export interface PreferencesView {
  defaultLibraryStateFilter: LibraryState[]
}

export class InvalidPreferencesError extends Data.TaggedError('InvalidPreferencesError')<{
  message: string
}> { }

export interface PreferencesServiceInterface {
  getPreferences: (userId: string) => Effect.Effect<PreferencesView, PreferencesError, DbService>
  updatePreferences: (userId: string, input: unknown) => Effect.Effect<PreferencesView, InvalidPreferencesError | PreferencesError, DbService>
}

export class PreferencesService extends Context.Tag('PreferencesService')<PreferencesService, PreferencesServiceInterface>() { }

const toView = (defaultLibraryStateFilter: LibraryState[]): PreferencesView => ({
  defaultLibraryStateFilter
})

export const PreferencesServiceLive = Layer.effect(
  PreferencesService,
  Effect.gen(function* () {
    const preferencesRepo = yield* PreferencesRepository

    return {
      getPreferences: userId =>
        Effect.gen(function* () {
          const preferences = yield* preferencesRepo.getPreferences(userId)
          return toView(preferences?.defaultLibraryStateFilter ?? DEFAULT_LIBRARY_STATE_FILTER)
        }),

      updatePreferences: (userId, input) =>
        Effect.gen(function* () {
          const parsed = yield* Effect.try({
            try: () => preferencesSchema.parse(input),
            catch: error => new InvalidPreferencesError({
              message: error instanceof Error ? error.message : 'Preferences are invalid'
            })
          })
          const preferences = yield* preferencesRepo.upsertPreferences(userId, parsed.defaultLibraryStateFilter)
          return toView(preferences.defaultLibraryStateFilter)
        })
    }
  })
)

export const getUserPreferences = (userId: string) =>
  Effect.flatMap(PreferencesService, service => service.getPreferences(userId))

export const updateUserPreferences = (userId: string, input: unknown) =>
  Effect.flatMap(PreferencesService, service => service.updatePreferences(userId, input))

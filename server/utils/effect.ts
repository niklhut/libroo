import { Effect, Layer } from 'effect'
import type { H3Event } from 'h3'
import type { DbService } from '../services/db.service'
import { DbServiceLive } from '../services/db.service'
import type { StorageService } from '../services/storage.service'
import { StorageServiceLive } from '../services/storage.service'
import type { AuthService } from '../services/auth.service'
import { AuthServiceLive } from '../services/auth.service'
import type { BookRepository } from '../repositories/book.repository'
import { BookRepositoryLive } from '../repositories/book.repository'
import type { OpenLibraryRepository } from '../repositories/openLibrary.repository'
import { OpenLibraryRepositoryLive } from '../repositories/openLibrary.repository'

// Base services layer
const BaseServicesLive = Layer.mergeAll(
  DbServiceLive,
  StorageServiceLive,
  AuthServiceLive,
  OpenLibraryRepositoryLive
)

// Repository layer (depends on base services)
const RepositoriesLive = Layer.provideMerge(
  BookRepositoryLive,
  BaseServicesLive
)

// Combined live layer for all services
export const MainLive = Layer.provideMerge(
  RepositoriesLive,
  BaseServicesLive
)

// Type for all available services
export type MainServices
  = | DbService
    | StorageService
    | AuthService
    | BookRepository
    | OpenLibraryRepository

// Helper to run an Effect in a Nitro event handler
export async function runEffect<A, E>(
  effect: Effect.Effect<A, E, MainServices>,
  _event?: H3Event
): Promise<A> {
  const runnable = Effect.provide(effect, MainLive)
  return Effect.runPromise(runnable)
}

// Re-export common Effect utilities
export { Effect, Layer, Context, Data, pipe } from 'effect'

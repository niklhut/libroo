import { Effect, Layer } from 'effect'
import type { H3Event } from 'h3'

// Base services layer (no dependencies)
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

// Service layer (depends on repositories)
const ServicesLive = Layer.provideMerge(
  BookServiceLive,
  RepositoriesLive
)

// Combined live layer for all services
export const MainLive = Layer.provideMerge(
  ServicesLive,
  BaseServicesLive
)

// Type for all available services
export type MainServices
  = DbService
    | StorageService
    | AuthService
    | BookRepository
    | OpenLibraryRepository
    | BookService

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

import { Effect, Layer, pipe } from 'effect'
import { HttpClient } from '@effect/platform'
import { NodeHttpClient } from '@effect/platform-node'
import type { H3Error } from 'h3'

// Create HttpClient layer that follows redirects (OpenLibrary cover URLs redirect)
const HttpClientLive = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const baseClient = yield* HttpClient.HttpClient
    return HttpClient.followRedirects(baseClient, 10)
  })
).pipe(Layer.provide(NodeHttpClient.layer))

// Base services layer (no dependencies)
const BaseServicesLive = Layer.mergeAll(
  DbServiceLive,
  StorageServiceLive,
  AuthServiceLive,
  OpenLibraryRepositoryLive,
  HttpClientLive
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
  | HttpClient.HttpClient

// Helper to safely get property from unknown object
function getProp<T>(obj: unknown, key: string): T | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    return (obj as Record<string, unknown>)[key] as T
  }
  return undefined
}

// Error mappings for converting tagged errors to HTTP status codes
const errorStatusCodes: Record<string, number> = {
  UnauthorizedError: 401,
  BookNotFoundError: 404,
  OpenLibraryBookNotFoundError: 404,
  BookAlreadyOwnedError: 409,
  OpenLibraryApiError: 502,
  BookCreateError: 500,
  DatabaseError: 500,
  StorageError: 500
}

// Custom error message formatters
const errorMessageFormatters: Record<string, (error: unknown) => string> = {
  BookNotFoundError: (error) => {
    const isbn = getProp<string>(error, 'isbn')
    return isbn ? `Book with ISBN ${isbn} not found` : 'Book not found'
  },
  BookAlreadyOwnedError: (error) => {
    const isbn = getProp<string>(error, 'isbn')
    return `You already have this book (ISBN: ${isbn || 'unknown'}) in your library`
  }
}

/**
 * Converts any error to an H3Error within Effect.
 * Uses Effect.logError for structured logging.
 */
export function handleError(error: unknown): Effect.Effect<H3Error> {
  return Effect.gen(function* () {
    // Check if it's already an H3 error
    if (isError(error)) {
      return error as H3Error
    }

    // Check if it's a tagged error with _tag
    const tag = getProp<string>(error, '_tag')
    if (tag) {
      const statusCode = errorStatusCodes[tag] ?? 500
      const formatter = errorMessageFormatters[tag]
      const message = formatter
        ? formatter(error)
        : getProp<string>(error, 'message') ?? tag

      yield* Effect.logError(`[${tag}] ${message}`)
      return createError({ statusCode, message })
    }

    // Unknown error - log and return internal server error
    const message = error instanceof Error ? error.message : String(error)
    yield* Effect.logError(`Unexpected error: ${message}`)
    return createError({ statusCode: 500, message: 'Internal Server Error' })
  })
}

// Helper to run an Effect in a Nitro event handler or elsewhere
export async function runEffect<A, E>(
  effect: Effect.Effect<A, E, MainServices>
): Promise<A> {
  const result = await pipe(
    effect,
    Effect.provide(MainLive),
    Effect.catchAll(handleError),
    Effect.runPromise
  )

  if (isError(result)) {
    throw result
  }

  return result as A
}

// Re-export common Effect utilities
export { Effect, Layer, Context, Data } from 'effect'

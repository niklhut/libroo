import { Cause, Effect, Exit, Layer, pipe } from 'effect'
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
  HttpClientLive
)

// Repository layer (depends on base services)
const RepositoriesLive = Layer.provideMerge(
  Layer.mergeAll(BookRepositoryLive, OpenLibraryRepositoryLive),
  BaseServicesLive
)

// Service layer (depends on repositories)
const ServicesLive = Layer.provideMerge(
  BookServiceLive,
  RepositoriesLive
)

// Combined live layer for all services
export const MainLive = ServicesLive

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
 * Converts any error to an H3Error and throws it as a defect.
 *
 * This uses Effect.die() to immediately terminate the Effect with the H3Error
 * as an unrecoverable defect. The runEffect function will catch this defect
 * and throw the H3Error to the HTTP layer.
 */
export function handleError(error: unknown): Effect.Effect<never> {
  return Effect.gen(function* () {
    // Check if it's already an H3 error - throw it directly
    if (isError(error)) {
      return yield* Effect.die(error)
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
      return yield* Effect.die(createError({ statusCode, message }))
    }

    // Unknown error - log and throw as internal server error
    const message = error instanceof Error ? error.message : String(error)
    yield* Effect.logError(`Unexpected error: ${message}`)
    return yield* Effect.die(createError({ statusCode: 500, message: 'Internal Server Error' }))
  })
}

/**
 * Runs an Effect in a Nitro event handler, converting tagged errors to H3Errors
 * and throwing them to the HTTP layer.
 *
 * Error handling flow:
 * 1. Effect.catchAll intercepts all expected errors (E channel)
 * 2. handleError converts them to H3Errors and uses Effect.die() to throw as defects
 * 3. runPromiseExit captures the Exit (success or failure with Cause)
 * 4. On failure, we extract the H3Error defect and throw it
 * 5. On success, we return the value directly (no isError check needed)
 */
export async function runEffect<A, E>(
  effect: Effect.Effect<A, E, MainServices>
): Promise<A> {
  const exit = await pipe(
    effect,
    Effect.provide(MainLive),
    Effect.catchAll(handleError),
    Effect.runPromiseExit
  )

  return Exit.match(exit, {
    onFailure: (cause) => {
      // handleError uses Effect.die() to throw H3Errors as defects.
      // Extract the first defect (which should be our H3Error) and throw it.
      const defects = [...Cause.defects(cause)]
      if (defects.length > 0 && isError(defects[0])) {
        throw defects[0]
      }
      // Fallback for unexpected causes
      throw createError({ statusCode: 500, message: 'Unexpected internal error' })
    },
    onSuccess: (value) => value
  })
}

// Re-export common Effect utilities
export { Effect, Layer, Context, Data } from 'effect'

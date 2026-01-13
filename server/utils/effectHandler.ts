import { Effect } from 'effect'
import type { H3Event, H3Error } from 'h3'
import { MainLive, type MainServices } from './effect'
import { requireAuth } from '../services/auth.service'

// Default internal server error
const internalServerError = createError({ statusCode: 500, message: 'Internal Server Error' })

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
  BookAlreadyOwnedError: 409,
  OpenLibraryApiError: 502,
  BookCreateError: 500
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
function handleError(error: unknown): Effect.Effect<H3Error> {
  return Effect.gen(function* () {
    // Check if it's already an H3 error
    if (error && typeof error === 'object' && 'statusCode' in error) {
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
    return internalServerError
  })
}

/**
 * Creates a fully Effect-based event handler with automatic error conversion.
 * Authentication is always required.
 *
 * Errors are handled within Effect using catchAll, converting them to H3 errors.
 * The H3 error is then thrown after the Effect completes for proper HTTP response handling.
 *
 * Example usage:
 * ```ts
 * export default effectHandler(
 *   (event, user) => Effect.gen(function* () {
 *     const library = yield* getLibrary(user.id)
 *     return library
 *   })
 * )
 * ```
 */
export function effectHandler<A, E>(
  handler: (
    event: H3Event,
    user: { id: string, name: string, email: string }
  ) => Effect.Effect<A, E, MainServices>
) {
  return defineEventHandler(async (event) => {
    const effect = Effect.gen(function* () {
      const user = yield* requireAuth(event)
      return yield* handler(event, user)
    })

    // Run the effect pipeline:
    // 1. Provide dependencies (MainLive)
    // 2. Catch all errors and convert them to H3 errors (as success values)
    // 3. Run the promise
    const result = await effect.pipe(
      Effect.provide(MainLive),
      Effect.catchAll(handleError),
      Effect.runPromise
    )

    // If the result is an H3 error, throw it for proper HTTP error response
    // (returning it would just serialize as JSON with 200 OK)
    if (result && typeof result === 'object' && 'statusCode' in result && 'message' in result) {
      throw result
    }

    return result
  })
}

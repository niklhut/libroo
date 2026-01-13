import { Effect } from 'effect'
import type { H3Event } from 'h3'
import { MainLive, type MainServices } from './effect'
import { requireAuth } from '../services/auth.service'

// Error mapping for converting Effect errors to HTTP errors
interface HttpErrorMapping {
  statusCode: number
  message: string
}

// Helper to safely get string property
function getStringProp(obj: unknown, key: string): string | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    const value = (obj as Record<string, unknown>)[key]
    return typeof value === 'string' ? value : undefined
  }
  return undefined
}

// Default error mappings for known error types
const errorMappings: Record<string, (error: unknown) => HttpErrorMapping> = {
  UnauthorizedError: () => ({
    statusCode: 401,
    message: 'Unauthorized'
  }),
  BookNotFoundError: error => ({
    statusCode: 404,
    message: getStringProp(error, 'isbn')
      ? `Book with ISBN ${getStringProp(error, 'isbn')} not found`
      : `Book not found`
  }),
  BookAlreadyOwnedError: error => ({
    statusCode: 409,
    message: `You already have this book (ISBN: ${getStringProp(error, 'isbn') || 'unknown'}) in your library`
  }),
  OpenLibraryApiError: error => ({
    statusCode: 502,
    message: getStringProp(error, 'message') || 'Failed to communicate with OpenLibrary'
  }),
  BookCreateError: error => ({
    statusCode: 500,
    message: getStringProp(error, 'message') || 'Failed to create book'
  })
}

// Convert any Effect error to an H3 error and throw it
function throwH3Error(error: unknown): never {
  // If it's already an H3 error, throw it
  if (error && typeof error === 'object' && 'statusCode' in error) {
    throw error
  }

  // Check if it's a tagged error with _tag
  if (error && typeof error === 'object' && '_tag' in error) {
    const tag = (error as { _tag: string })._tag
    const mapper = errorMappings[tag]
    if (mapper) {
      const { statusCode, message } = mapper(error)
      throw createError({ statusCode, message })
    }
  }

  // Default to internal server error
  const message = error instanceof Error ? error.message : 'Internal server error'
  throw createError({ statusCode: 500, message })
}

/**
 * Creates a fully Effect-based event handler with automatic error conversion.
 * Authentication is always required.
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
    user: { id: string; name: string; email: string }
  ) => Effect.Effect<A, E, MainServices>
) {
  return defineEventHandler(async (event) => {
    const effect = Effect.gen(function* () {
      const user = yield* requireAuth(event)
      return yield* handler(event, user)
    })

    // 1. Provide dependencies (MainLive)
    // 2. Catch all errors and throw them as H3 errors (using Effect.sync to run the throwing function)
    // 3. Run the promise
    return await effect.pipe(
      Effect.provide(MainLive),
      Effect.catchAll((error) => Effect.sync(() => throwH3Error(error))),
      Effect.runPromise
    )
  })
}

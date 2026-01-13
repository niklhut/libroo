import { Effect } from 'effect'
import type { H3Event, H3Error } from 'h3'
import { MainLive } from './effect'
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

// Convert any Effect error to an H3 error
function errorToH3Error(error: unknown): H3Error {
  // If it's already an H3 error, return it
  if (error && typeof error === 'object' && 'statusCode' in error) {
    return error as H3Error
  }

  // Check if it's a tagged error with _tag
  if (error && typeof error === 'object' && '_tag' in error) {
    const tag = (error as { _tag: string })._tag
    const mapper = errorMappings[tag]
    if (mapper) {
      const { statusCode, message } = mapper(error)
      return createError({ statusCode, message })
    }
  }

  // Default to internal server error
  const message = error instanceof Error ? error.message : 'Internal server error'
  return createError({ statusCode: 500, message })
}

// Type for the effect handler options
interface EffectHandlerOptions {
  // Whether auth is required (default: true)
  requireAuth?: boolean
}

/**
 * Creates a fully Effect-based event handler with automatic error conversion.
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
export function effectHandler<A>(
  handler: (
    event: H3Event,
    user: { id: string, name: string, email: string }
  ) => Effect.Effect<A, unknown, unknown>,
  options: EffectHandlerOptions = {}
) {
  const { requireAuth: needsAuth = true } = options

  return defineEventHandler(async (event) => {
    const effect = Effect.gen(function* () {
      // Always check auth first if required
      let user: { id: string, name: string, email: string }

      if (needsAuth) {
        user = yield* requireAuth(event)
      } else {
        // Provide a dummy user for non-auth endpoints
        user = { id: '', name: '', email: '' }
      }

      // Run the handler
      return yield* handler(event, user)
    })

    // Provide layers and run - use type assertion to handle the layer type
    const runnable = Effect.provide(effect, MainLive) as Effect.Effect<A, unknown, never>

    try {
      return await Effect.runPromise(runnable)
    } catch (error) {
      throw errorToH3Error(error)
    }
  })
}

/**
 * Creates an Effect-based handler that doesn't require authentication.
 */
export function effectHandlerPublic<A>(
  handler: (event: H3Event) => Effect.Effect<A, unknown, unknown>
) {
  return defineEventHandler(async (event) => {
    const effect = handler(event)

    // Provide layers and run - use type assertion to handle the layer type
    const runnable = Effect.provide(effect, MainLive) as Effect.Effect<A, unknown, never>

    try {
      return await Effect.runPromise(runnable)
    } catch (error) {
      throw errorToH3Error(error)
    }
  })
}

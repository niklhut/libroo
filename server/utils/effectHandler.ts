import { Effect } from 'effect'
import type { H3Event } from 'h3'
import { type MainServices, runEffect } from './effect'
import { requireAuth } from '../services/auth.service'

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
    return runEffect(effect)
  })
}

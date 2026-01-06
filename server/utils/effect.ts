import { Effect, Layer } from 'effect'
import type { H3Event } from 'h3'
import { DbService, DbServiceLive } from '../services/db.service'
import { StorageService, StorageServiceLive } from '../services/storage.service'
import { AuthService, AuthServiceLive } from '../services/auth.service'

// Combined live layer for all services
export const MainLive = Layer.mergeAll(
  DbServiceLive,
  StorageServiceLive,
  AuthServiceLive
)

// Helper to run an Effect in a Nitro event handler
export async function runEffect<A, E>(
  effect: Effect.Effect<A, E, DbService | StorageService | AuthService>,
  _event?: H3Event
): Promise<A> {
  const runnable = Effect.provide(effect, MainLive)
  return Effect.runPromise(runnable)
}

// Re-export common Effect utilities
export { Effect, Layer, Context, Data, pipe } from 'effect'

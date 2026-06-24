import { Effect } from 'effect'
import type { H3Event } from 'h3'
import { AuthSessionRepositoryLive } from '../repositories/auth-session.repository'
import { AuthSessionService, AuthSessionServiceLive } from '../services/auth-session.service'

export function resolveRequestAuthSession(event: H3Event) {
  return Effect.runPromise(
    Effect.flatMap(AuthSessionService, service => service.resolve(event)).pipe(
      Effect.provide(AuthSessionServiceLive),
      Effect.provide(AuthSessionRepositoryLive)
    )
  )
}

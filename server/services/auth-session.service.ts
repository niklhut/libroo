import { Context, Layer } from 'effect'
import type { Effect } from 'effect'
import type { H3Event } from 'h3'
import type {
  AuthSessionData,
  AuthSessionRepository,
  AuthSessionRepositoryError
} from '../repositories/auth-session.repository'
import {
  getAuthSession
} from '../repositories/auth-session.repository'

export interface AuthSessionServiceInterface {
  resolve: (event: H3Event) => Effect.Effect<AuthSessionData, AuthSessionRepositoryError, AuthSessionRepository>
}

export class AuthSessionService extends Context.Tag('AuthSessionService')<
  AuthSessionService,
  AuthSessionServiceInterface
>() { }

export const AuthSessionServiceLive = Layer.succeed(AuthSessionService, {
  resolve: event => getAuthSession(event.headers)
})

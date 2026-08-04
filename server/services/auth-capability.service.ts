import { Context, Effect, Layer } from 'effect'
import type { AuthCapabilities } from '~~/shared/types/auth-capabilities'
import { getAuthCapabilities } from '../utils/auth-capabilities'

export interface AuthCapabilityServiceInterface {
  getCapabilities: () => Effect.Effect<AuthCapabilities>
}

export class AuthCapabilityService extends Context.Tag('AuthCapabilityService')<AuthCapabilityService, AuthCapabilityServiceInterface>() { }

export const AuthCapabilityServiceLive = Layer.succeed(AuthCapabilityService, {
  getCapabilities: () => Effect.sync(getAuthCapabilities)
})

export const getAuthCapabilityFlags = () =>
  Effect.flatMap(AuthCapabilityService, service => service.getCapabilities())

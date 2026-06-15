import { Context, Effect, Layer } from 'effect'
import type { EmailCapabilities } from '~~/shared/types/email-capabilities'
import { getEmailCapabilities } from '../utils/email-capabilities'

export interface EmailCapabilityServiceInterface {
  getCapabilities: () => Effect.Effect<EmailCapabilities>
}

export class EmailCapabilityService extends Context.Tag('EmailCapabilityService')<EmailCapabilityService, EmailCapabilityServiceInterface>() { }

export const EmailCapabilityServiceLive = Layer.succeed(EmailCapabilityService, {
  getCapabilities: () => Effect.sync(getEmailCapabilities)
})

export const getEmailCapabilityFlags = () =>
  Effect.flatMap(EmailCapabilityService, service => service.getCapabilities())

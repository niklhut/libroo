import { Effect, Layer } from 'effect'
import * as HttpClient from '@effect/platform/HttpClient'
import { NodeHttpClient } from '@effect/platform-node'
import { DbServiceSelfHostLive } from './providers/db.selfhost'
import { EmailServiceSmtpLive } from './providers/email.smtp'
import { StorageServiceLocalSharpLive } from './providers/storage.local-sharp'

const HttpClientLive = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const baseClient = yield* HttpClient.HttpClient
    return HttpClient.followRedirects(baseClient, 10)
  })
).pipe(Layer.provide(NodeHttpClient.layer))

export const RuntimeInfrastructureLive = Layer.mergeAll(
  DbServiceSelfHostLive,
  StorageServiceLocalSharpLive,
  EmailServiceSmtpLive,
  HttpClientLive
)

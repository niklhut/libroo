import { Effect, Layer } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
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
).pipe(Layer.provide(NodeHttpClient.layerNodeHttp))

export const RuntimeInfrastructureLive = Layer.mergeAll(
  DbServiceSelfHostLive,
  StorageServiceLocalSharpLive,
  EmailServiceSmtpLive,
  HttpClientLive
)

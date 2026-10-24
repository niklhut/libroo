import { Effect, Layer } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'
import { DbServiceCloudflareLive } from './providers/db.cloudflare'
import { EmailServicePlunkLive } from './providers/email.plunk'
import { StorageServiceCloudflareLive } from './providers/storage.cloudflare'

const HttpClientLive = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const baseClient = yield* HttpClient.HttpClient
    return HttpClient.followRedirects(baseClient, 10)
  })
).pipe(Layer.provide(FetchHttpClient.layer))

export const RuntimeInfrastructureLive = Layer.mergeAll(
  DbServiceCloudflareLive,
  StorageServiceCloudflareLive,
  EmailServicePlunkLive,
  HttpClientLive
)

import { Effect, Layer } from 'effect'
import * as HttpClient from '@effect/platform/HttpClient'
import { describe, expect, it, vi } from 'vitest'
import { DbService } from '../../../../server/services/db.service'
import { StorageService, type StorageServiceInterface } from '../../../../server/services/storage.service'

import {
  OpenLibraryRepository,
  OpenLibraryRepositoryLive
} from '../../../../server/repositories/openLibrary.repository'

vi.mock('../../../../server/runtime/profile.active', () => ({ runtimeProfile: 'cloudflare' }))

describe('OpenLibraryRepository Cloudflare pacing', () => {
  it('skips an optional cover request when outbound pacing fails', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      openLibraryRequestTimeoutSeconds: 12,
      openLibraryCoverTimeoutSeconds: 20,
      openLibraryContactEmail: ''
    }))
    const httpRequest = vi.fn(() => Effect.die('Cover HTTP request must not run'))
    const httpClient = HttpClient.make(httpRequest)

    const result = await Effect.runPromise(Effect.flatMap(OpenLibraryRepository, repository =>
      repository.downloadCover('9780306406157')
    ).pipe(
      Effect.provide(OpenLibraryRepositoryLive),
      Effect.provide(Layer.succeed(DbService, {
        executeAtomic: vi.fn(async () => {
          throw new Error('limiter unavailable')
        })
      } as never)),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, httpClient)),
      Effect.provide(Layer.succeed(StorageService, {} as StorageServiceInterface))
    ))

    expect(result).toBeNull()
    expect(httpRequest).not.toHaveBeenCalled()
  })
})

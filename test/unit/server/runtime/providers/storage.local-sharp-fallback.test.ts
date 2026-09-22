import { Effect, Either } from 'effect'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StorageError, StorageService } from '../../../../../server/services/storage.service'

vi.mock('sharp', () => {
  throw new Error('simulated unsupported CPU')
})

const { StorageServiceLocalSharpLive } = await import('../../../../../server/runtime/providers/storage.local-sharp')

describe('StorageServiceLocalSharpLive without Sharp', () => {
  const originalLocalStorageDir = process.env.NUXT_LOCAL_STORAGE_DIR
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'libroo-storage-local-sharp-fallback-'))
    process.env.NUXT_LOCAL_STORAGE_DIR = tempDir
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    if (originalLocalStorageDir === undefined) {
      Reflect.deleteProperty(process.env, 'NUXT_LOCAL_STORAGE_DIR')
    } else {
      process.env.NUXT_LOCAL_STORAGE_DIR = originalLocalStorageDir
    }
    await rm(tempDir, { recursive: true, force: true })
  })

  it.each([
    ['JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg', '.jpg'],
    ['PNG', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png', '.png'],
    ['WebP', Buffer.from('RIFFxxxxWEBP', 'ascii'), 'image/webp', '.webp'],
    ['GIF', Buffer.from('GIF89a', 'ascii'), 'image/gif', '.gif']
  ])('stores original %s bytes with a matching path and content type', async (_label, fixture, contentType, extension) => {
    const metadata = await run(Effect.flatMap(StorageService, service =>
      service.putCoverImage('covers/manual/book.webp', fixture)
    ))

    expect(metadata).toMatchObject({
      pathname: `covers/manual/book${extension}`,
      contentType,
      size: fixture.length
    })
    await expect(readFile(join(tempDir, `covers/manual/book${extension}`))).resolves.toEqual(fixture)
  })

  it('continues rejecting unrecognized image bytes', async () => {
    const result = await run(Effect.either(Effect.flatMap(StorageService, service =>
      service.putCoverImage('covers/manual/book.webp', Buffer.from('not an image'))
    )))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(StorageError)
      expect(result.left).toMatchObject({ operation: 'convertCoverImage' })
    }
  })

  function run<A, E>(effect: Effect.Effect<A, E, StorageService>) {
    return Effect.runPromise(effect.pipe(
      Effect.provide(StorageServiceLocalSharpLive)
    ))
  }
})

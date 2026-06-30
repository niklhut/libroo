import { Effect, Either } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StorageError, StorageService } from '../../../../../server/services/storage.service'

const blobMock = vi.hoisted(() => ({
  put: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  list: vi.fn()
}))

vi.mock('@nuxthub/blob', () => ({
  blob: blobMock
}))

const { StorageServiceCloudflareLive } = await import('../../../../../server/runtime/providers/storage.cloudflare')

describe('StorageServiceCloudflareLive', () => {
  const jpegFixture = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])
  const pngFixture = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
  const webpFixture = Buffer.from('RIFFxxxxWEBPVP8 ', 'ascii')
  const gifFixture = Buffer.from('GIF89a', 'ascii')
  const octetFixture = Buffer.from([0x00, 0x01, 0x02, 0x03])

  beforeEach(() => {
    blobMock.put.mockReset()
    blobMock.get.mockReset()
    blobMock.delete.mockReset()
    blobMock.list.mockReset()
  })

  describe('cover image content-type detection and pathname rewriting', () => {
    it.each([
      ['JPEG', jpegFixture, 'image/jpeg', 'covers/cover.jpg'],
      ['PNG', pngFixture, 'image/png', 'covers/cover.png'],
      ['WebP', webpFixture, 'image/webp', 'covers/cover.webp'],
      ['GIF', gifFixture, 'image/gif', 'covers/cover.gif']
    ])('stores %s cover images as-is with detected metadata', async (_label, fixture, contentType, pathname) => {
      const uploadedAt = new Date('2026-06-30T12:00:00.000Z')
      blobMock.put.mockResolvedValueOnce({
        pathname,
        contentType,
        size: fixture.length,
        uploadedAt
      })

      // Cloudflare intentionally stores the original image bytes after magic-byte detection;
      // the local Sharp provider re-encodes cover images to WebP.
      const result = await run(Effect.flatMap(StorageService, service =>
        service.putCoverImage('covers/cover', fixture)
      ))

      expect(blobMock.put).toHaveBeenCalledWith(pathname, fixture, {
        contentType
      })
      expect(result).toMatchObject({
        pathname,
        contentType,
        size: fixture.length,
        uploadedAt
      })
    })

    it('replaces an existing extension with the detected image extension', async () => {
      blobMock.put.mockResolvedValueOnce({
        pathname: 'covers/cover.png',
        contentType: 'image/png',
        uploadedAt: new Date()
      })

      await run(Effect.flatMap(StorageService, service =>
        service.putCoverImage('covers/cover.jpeg', pngFixture)
      ))

      expect(blobMock.put).toHaveBeenCalledWith('covers/cover.png', pngFixture, {
        contentType: 'image/png'
      })
    })

    it('rejects unrecognized cover image bytes before storing', async () => {
      const result = await run(Effect.either(Effect.flatMap(StorageService, service =>
        service.putCoverImage('covers/cover', octetFixture)
      )))

      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(StorageError)
        expect(result.left).toMatchObject({
          operation: 'convertCoverImage'
        })
      }
      expect(blobMock.put).not.toHaveBeenCalled()
    })
  })

  describe('delegation and metadata normalization', () => {
    it('forwards put arguments and normalizes returned metadata dates', async () => {
      const data = Buffer.from('cloud blob')
      blobMock.put.mockResolvedValueOnce({
        pathname: 'docs/blob.txt',
        contentType: 'text/plain',
        size: data.length,
        uploadedAt: '2026-06-30T12:34:56.000Z'
      })

      const result = await run(Effect.flatMap(StorageService, service =>
        service.put('docs/blob.txt', data, { contentType: 'text/plain', prefix: 'docs/' })
      ))

      // Cloudflare uses native R2/NuxtHub metadata; the local provider writes .meta.json sidecars.
      expect(blobMock.put).toHaveBeenCalledWith('docs/blob.txt', data, {
        contentType: 'text/plain',
        prefix: 'docs/'
      })
      expect(result).toMatchObject({
        pathname: 'docs/blob.txt',
        contentType: 'text/plain',
        size: data.length
      })
      expect(result.uploadedAt).toEqual(new Date('2026-06-30T12:34:56.000Z'))
    })

    it('returns blob.get results as-is, including null', async () => {
      const blob = new Blob(['hello'], { type: 'text/plain' })
      blobMock.get.mockResolvedValueOnce(blob)
      blobMock.get.mockResolvedValueOnce(null)

      // Unlike the local provider, Cloudflare relies on blob.get's native null behavior directly.
      await expect(run(Effect.flatMap(StorageService, service => service.get('docs/blob.txt')))).resolves.toBe(blob)
      await expect(run(Effect.flatMap(StorageService, service => service.get('docs/missing.txt')))).resolves.toBeNull()
      expect(blobMock.get).toHaveBeenNthCalledWith(1, 'docs/blob.txt')
      expect(blobMock.get).toHaveBeenNthCalledWith(2, 'docs/missing.txt')
    })

    it('forwards list prefix and normalizes listed metadata', async () => {
      blobMock.list.mockResolvedValueOnce({
        blobs: [
          {
            pathname: 'covers/a.jpg',
            contentType: 'image/jpeg',
            size: 10,
            uploadedAt: '2026-06-30T01:00:00.000Z'
          },
          {
            pathname: 'covers/b.png',
            contentType: 'image/png',
            size: 20,
            uploadedAt: new Date('2026-06-30T02:00:00.000Z')
          }
        ]
      })

      const result = await run(Effect.flatMap(StorageService, service => service.list('covers/')))

      expect(blobMock.list).toHaveBeenCalledWith({
        prefix: 'covers/'
      })
      expect(result).toEqual([
        {
          pathname: 'covers/a.jpg',
          contentType: 'image/jpeg',
          size: 10,
          uploadedAt: new Date('2026-06-30T01:00:00.000Z')
        },
        {
          pathname: 'covers/b.png',
          contentType: 'image/png',
          size: 20,
          uploadedAt: new Date('2026-06-30T02:00:00.000Z')
        }
      ])
    })

    it('forwards delete pathnames', async () => {
      blobMock.delete.mockResolvedValueOnce(undefined)

      await expect(run(Effect.flatMap(StorageService, service => service.delete('docs/blob.txt')))).resolves.toBeUndefined()

      expect(blobMock.delete).toHaveBeenCalledWith('docs/blob.txt')
    })
  })

  function run<A, E>(effect: Effect.Effect<A, E, StorageService>) {
    return Effect.runPromise(effect.pipe(
      Effect.provide(StorageServiceCloudflareLive)
    ))
  }
})

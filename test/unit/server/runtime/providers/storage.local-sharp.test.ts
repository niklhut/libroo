import { Effect, Either } from 'effect'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StorageError, StorageService } from '../../../../../server/services/storage.service'
import { StorageServiceLocalSharpLive } from '../../../../../server/runtime/providers/storage.local-sharp'

describe('StorageServiceLocalSharpLive', () => {
  const originalLocalStorageDir = process.env.NUXT_LOCAL_STORAGE_DIR
  let tempDir: string
  let pngFixture: Buffer
  let jpegFixture: Buffer
  let invalidFixture: Buffer

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'libroo-storage-local-sharp-'))
    process.env.NUXT_LOCAL_STORAGE_DIR = tempDir
    pngFixture = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 40, g: 80, b: 120, alpha: 1 }
      }
    }).png().toBuffer()
    jpegFixture = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: { r: 220, g: 180, b: 90 }
      }
    }).jpeg().toBuffer()
    invalidFixture = Buffer.from('this is not an image')
  })

  afterEach(async () => {
    if (originalLocalStorageDir === undefined) {
      Reflect.deleteProperty(process.env, 'NUXT_LOCAL_STORAGE_DIR')
    } else {
      process.env.NUXT_LOCAL_STORAGE_DIR = originalLocalStorageDir
    }
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('cover image conversion', () => {
    it('converts supported cover images to WebP metadata and blob content', async () => {
      const metadata = await run(Effect.flatMap(StorageService, service =>
        service.putCoverImage('covers/book-cover', pngFixture)
      ))

      expect(metadata).toMatchObject({
        pathname: 'covers/book-cover',
        contentType: 'image/webp'
      })
      expect(metadata.size).toBeGreaterThan(0)
      expect(metadata.uploadedAt).toBeInstanceOf(Date)

      const stored = await run(Effect.flatMap(StorageService, service => service.get('covers/book-cover')))
      expect(stored).toBeInstanceOf(Blob)
      expect(stored?.type).toBe('image/webp')
      expect(await sharp(Buffer.from(await stored!.arrayBuffer())).metadata()).toMatchObject({
        format: 'webp'
      })
    })

    it('fails malformed cover images with a convertCoverImage StorageError', async () => {
      const result = await run(Effect.either(Effect.flatMap(StorageService, service =>
        service.putCoverImage('covers/bad-cover', invalidFixture)
      )))

      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(StorageError)
        expect(result.left).toMatchObject({
          operation: 'convertCoverImage'
        })
      }
    })
  })

  describe('path safety guard', () => {
    const unsafePathnames = [
      '/absolute/blob.txt',
      'C:\\absolute\\blob.txt',
      'C:/absolute/blob.txt',
      '\\\\server\\share\\blob.txt',
      '../outside.txt',
      'covers/../../outside.txt',
      '..\\outside.txt',
      'covers\\..\\outside.txt',
      'covers/null\0byte.txt'
    ]

    it.each(unsafePathnames)('rejects unsafe put pathname %s before disk access', async (pathname) => {
      const result = await run(Effect.either(Effect.flatMap(StorageService, service =>
        service.put(pathname, Buffer.from('data'), { contentType: 'text/plain' })
      )))

      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(StorageError)
        expect(result.left).toMatchObject({
          operation: 'put'
        })
      }
    })

    it.each(unsafePathnames)('rejects unsafe get pathname %s before disk access', async (pathname) => {
      const result = await run(Effect.either(Effect.flatMap(StorageService, service =>
        service.get(pathname)
      )))

      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(StorageError)
        expect(result.left).toMatchObject({
          operation: 'get'
        })
      }
    })
  })

  describe('metadata lifecycle', () => {
    it('writes sidecar metadata, reads blobs, lists metadata, and deletes idempotently', async () => {
      const data = Buffer.from('hello local blob')
      const metadata = await run(Effect.flatMap(StorageService, service =>
        service.put('docs/blob.txt', data, { contentType: 'text/plain' })
      ))

      expect(metadata).toMatchObject({
        pathname: 'docs/blob.txt',
        contentType: 'text/plain',
        size: data.length
      })
      expect(metadata.uploadedAt).toBeInstanceOf(Date)

      const sidecar = JSON.parse(await readFile(join(tempDir, 'docs/blob.txt.meta.json'), 'utf8'))
      expect(sidecar).toMatchObject({
        pathname: 'docs/blob.txt',
        contentType: 'text/plain',
        size: data.length
      })
      expect(new Date(sidecar.uploadedAt)).toBeInstanceOf(Date)

      const blob = await run(Effect.flatMap(StorageService, service => service.get('docs/blob.txt')))
      expect(blob).toBeInstanceOf(Blob)
      expect(blob?.type).toBe('text/plain')
      expect(Buffer.from(await blob!.arrayBuffer())).toEqual(data)

      await expect(run(Effect.flatMap(StorageService, service => service.get('docs/missing.txt')))).resolves.toBeNull()

      const secondMetadata = await run(Effect.flatMap(StorageService, service =>
        service.put('covers/manual/book.jpg', jpegFixture, { contentType: 'image/jpeg' })
      ))

      const all = await run(Effect.flatMap(StorageService, service => service.list()))
      expect(all).toHaveLength(2)
      expect(all).toEqual(expect.arrayContaining([
        expect.objectContaining({
          pathname: 'docs/blob.txt',
          contentType: 'text/plain',
          size: data.length,
          uploadedAt: expect.any(Date)
        }),
        expect.objectContaining({
          pathname: 'covers/manual/book.jpg',
          contentType: 'image/jpeg',
          size: secondMetadata.size,
          uploadedAt: expect.any(Date)
        })
      ]))
      expect(all.map(entry => entry.pathname)).not.toContain('docs/blob.txt.meta.json')

      const prefixed = await run(Effect.flatMap(StorageService, service => service.list('covers/')))
      expect(prefixed).toHaveLength(1)
      expect(prefixed[0]).toMatchObject({
        pathname: 'covers/manual/book.jpg',
        contentType: 'image/jpeg',
        uploadedAt: expect.any(Date)
      })

      await run(Effect.flatMap(StorageService, service => service.delete('docs/blob.txt')))
      await expect(run(Effect.flatMap(StorageService, service => service.get('docs/blob.txt')))).resolves.toBeNull()
      await expect(run(Effect.flatMap(StorageService, service => service.delete('docs/blob.txt')))).resolves.toBeUndefined()
      await expect(run(Effect.flatMap(StorageService, service => service.delete('docs/never-existed.txt')))).resolves.toBeUndefined()
    })
  })

  function run<A, E>(effect: Effect.Effect<A, E, StorageService>) {
    return Effect.runPromise(effect.pipe(
      Effect.provide(StorageServiceLocalSharpLive)
    ))
  }
})

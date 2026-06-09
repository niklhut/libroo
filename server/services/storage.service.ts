import { Context, Effect, Layer, Data } from 'effect'
import { blob } from '@nuxthub/blob'
import sharp from 'sharp'

// Error types
export class StorageError extends Data.TaggedError('StorageError')<{
  message: string
  operation: 'put' | 'convertCoverImage' | 'putCoverImage' | 'get' | 'delete' | 'list'
}> { }

// Types for blob operations
export interface BlobPutOptions {
  contentType?: string
  prefix?: string
}

export interface BlobMetadata {
  pathname: string
  contentType?: string
  size?: number
  uploadedAt: Date
}

// Service interface
export interface StorageServiceInterface {
  put: (pathname: string, data: Buffer | Blob | ArrayBuffer, options?: BlobPutOptions) => Effect.Effect<BlobMetadata, StorageError>
  putCoverImage: (pathname: string, data: Buffer | ArrayBuffer) => Effect.Effect<BlobMetadata, StorageError>
  get: (pathname: string) => Effect.Effect<Blob | null, StorageError>
  delete: (pathname: string) => Effect.Effect<void, StorageError>
  list: (prefix?: string) => Effect.Effect<BlobMetadata[], StorageError>
}

// Service tag
export class StorageService extends Context.Tag('StorageService')<StorageService, StorageServiceInterface>() { }

// Live implementation - uses dynamic import to avoid build issues
export const StorageServiceLive = Layer.succeed(StorageService, {
  put: (pathname, data, options) =>
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: () => blob.put(pathname, data, {
          contentType: options?.contentType,
          prefix: options?.prefix
        }),
        catch: error => new StorageError({
          message: `Failed to put blob: ${error}`,
          operation: 'put'
        })
      })
      return {
        pathname: result.pathname,
        contentType: result.contentType,
        size: result.size,
        uploadedAt: new Date(result.uploadedAt)
      }
    }),

  putCoverImage: (pathname, data) =>
    Effect.gen(function* () {
      const inputBuffer = Buffer.isBuffer(data) ? data : Buffer.from(new Uint8Array(data))
      const webpBuffer = yield* Effect.tryPromise({
        try: () => sharp(inputBuffer).webp({ quality: 85 }).toBuffer(),
        catch: error => new StorageError({
          message: `Failed to convert cover image to WebP: ${error}`,
          operation: 'convertCoverImage'
        })
      })

      const result = yield* Effect.tryPromise({
        try: () => blob.put(pathname, webpBuffer, { contentType: 'image/webp' }),
        catch: error => new StorageError({
          message: `Failed to put cover image blob: ${error}`,
          operation: 'putCoverImage'
        })
      })
      return {
        pathname: result.pathname,
        contentType: result.contentType,
        size: result.size,
        uploadedAt: new Date(result.uploadedAt)
      }
    }),

  get: pathname =>
    Effect.gen(function* () {
      return yield* Effect.tryPromise({
        try: () => blob.get(pathname),
        catch: error => new StorageError({
          message: `Failed to get blob: ${error}`,
          operation: 'get'
        })
      })
    }),

  delete: pathname =>
    Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: () => blob.delete(pathname),
        catch: error => new StorageError({
          message: `Failed to delete blob: ${error}`,
          operation: 'delete'
        })
      })
    }),

  list: prefix =>
    Effect.gen(function* () {
      const results = yield* Effect.tryPromise({
        try: () => blob.list({ prefix }),
        catch: error => new StorageError({
          message: `Failed to list blobs: ${error}`,
          operation: 'list'
        })
      })
      return results.blobs.map(b => ({
        pathname: b.pathname,
        contentType: b.contentType,
        size: b.size,
        uploadedAt: b.uploadedAt instanceof Date ? b.uploadedAt : new Date(b.uploadedAt)
      }))
    })
})

// Helper effects
export const putBlob = (pathname: string, data: Buffer | Blob | ArrayBuffer, options?: BlobPutOptions) =>
  Effect.flatMap(StorageService, service => service.put(pathname, data, options))

export const putCoverImage = (pathname: string, data: Buffer | ArrayBuffer) =>
  Effect.flatMap(StorageService, service => service.putCoverImage(pathname, data))

export const getBlob = (pathname: string) =>
  Effect.flatMap(StorageService, service => service.get(pathname))

export const deleteBlob = (pathname: string) =>
  Effect.flatMap(StorageService, service => service.delete(pathname))

export const listBlobs = (prefix?: string) =>
  Effect.flatMap(StorageService, service => service.list(prefix))

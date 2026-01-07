import { Context, Effect, Layer } from 'effect'

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
  put: (pathname: string, data: Buffer | Blob | ArrayBuffer, options?: BlobPutOptions) => Effect.Effect<BlobMetadata, Error>
  get: (pathname: string) => Effect.Effect<Blob | null, Error>
  delete: (pathname: string) => Effect.Effect<void, Error>
  list: (prefix?: string) => Effect.Effect<BlobMetadata[], Error>
}

// Service tag
export class StorageService extends Context.Tag('StorageService')<StorageService, StorageServiceInterface>() { }

// Live implementation - uses dynamic import to avoid build issues
export const StorageServiceLive = Layer.succeed(StorageService, {
  put: (pathname, data, options) =>
    Effect.tryPromise({
      try: async () => {
        const { blob } = await import('hub:blob')
        const result = await blob.put(pathname, data, {
          contentType: options?.contentType,
          prefix: options?.prefix
        })
        return {
          pathname: result.pathname,
          contentType: result.contentType,
          size: result.size,
          uploadedAt: new Date(result.uploadedAt)
        }
      },
      catch: error => new Error(`Failed to put blob: ${error}`)
    }),

  get: pathname =>
    Effect.tryPromise({
      try: async () => {
        const { blob } = await import('hub:blob')
        return await blob.get(pathname)
      },
      catch: error => new Error(`Failed to get blob: ${error}`)
    }),

  delete: pathname =>
    Effect.tryPromise({
      try: async () => {
        const { blob } = await import('hub:blob')
        await blob.delete(pathname)
      },
      catch: error => new Error(`Failed to delete blob: ${error}`)
    }),

  list: prefix =>
    Effect.tryPromise({
      try: async () => {
        const { blob } = await import('hub:blob')
        const results = await blob.list({ prefix })
        return results.blobs.map(b => ({
          pathname: b.pathname,
          contentType: b.contentType,
          size: b.size,
          uploadedAt: b.uploadedAt instanceof Date ? b.uploadedAt : new Date(b.uploadedAt)
        }))
      },
      catch: error => new Error(`Failed to list blobs: ${error}`)
    })
})

// Helper effects
export const putBlob = (pathname: string, data: Buffer | Blob | ArrayBuffer, options?: BlobPutOptions) =>
  Effect.flatMap(StorageService, service => service.put(pathname, data, options))

export const getBlob = (pathname: string) =>
  Effect.flatMap(StorageService, service => service.get(pathname))

export const deleteBlob = (pathname: string) =>
  Effect.flatMap(StorageService, service => service.delete(pathname))

export const listBlobs = (prefix?: string) =>
  Effect.flatMap(StorageService, service => service.list(prefix))

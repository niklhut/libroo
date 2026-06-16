import { Context, Effect, Data } from 'effect'

export class StorageError extends Data.TaggedError('StorageError')<{
  message: string
  operation: 'put' | 'convertCoverImage' | 'putCoverImage' | 'get' | 'delete' | 'list'
}> { }

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

export interface StorageServiceInterface {
  put: (pathname: string, data: Buffer | Blob | ArrayBuffer, options?: BlobPutOptions) => Effect.Effect<BlobMetadata, StorageError>
  putCoverImage: (pathname: string, data: Buffer | ArrayBuffer) => Effect.Effect<BlobMetadata, StorageError>
  get: (pathname: string) => Effect.Effect<Blob | null, StorageError>
  delete: (pathname: string) => Effect.Effect<void, StorageError>
  list: (prefix?: string) => Effect.Effect<BlobMetadata[], StorageError>
}

export class StorageService extends Context.Tag('StorageService')<StorageService, StorageServiceInterface>() { }

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

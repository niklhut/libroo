import { Effect, Layer } from 'effect'
import * as FetchHttpClient from '@effect/platform/FetchHttpClient'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../../server/db/schema/index'
import { detectImageContentType, UNKNOWN_IMAGE_CONTENT_TYPE } from '../../shared/utils/image-content-type'
import { DbService, type DbServiceInterface } from '../../server/services/db.service'
import { StorageService, StorageError, type BlobMetadata } from '../../server/services/storage.service'
import { BookRepositoryLive } from '../../server/repositories/book.repository'
import { BookEnrichmentRepositoryLive } from '../../server/repositories/book-enrichment.repository'
import { CanonicalBookEnrichmentRepositoryLive } from '../../server/repositories/canonical-book-enrichment.repository'
import { OpenLibraryRepositoryLive } from '../../server/repositories/openLibrary.repository'

export interface WorkerRuntimeEnv { DB: D1Database, BLOB: R2Bucket }

async function metadata(bucket: R2Bucket, pathname: string, fallbackType?: string): Promise<BlobMetadata> {
  const object = await bucket.head(pathname)
  return {
    pathname,
    contentType: object?.httpMetadata?.contentType ?? fallbackType,
    size: object?.size,
    uploadedAt: object?.uploaded ?? new Date()
  }
}

export function createWorkerRuntime(env: WorkerRuntimeEnv) {
  const database = drizzle(env.DB, { schema })
  const db = Layer.succeed(DbService, {
    db: database as unknown as DbServiceInterface['db'],
    executeAtomic: statements => database.batch(statements(database as never))
  })
  const storage = Layer.succeed(StorageService, {
    put: (pathname, data, options) => Effect.tryPromise({
      try: async () => {
        await env.BLOB.put(pathname, data, options?.contentType ? { httpMetadata: { contentType: options.contentType } } : undefined)
        return metadata(env.BLOB, pathname, options?.contentType)
      },
      catch: error => new StorageError({ message: String(error), operation: 'put' })
    }),
    putCoverImage: (pathname, data) => Effect.tryPromise({
      try: async () => {
        const contentType = detectImageContentType(data)
        if (contentType === UNKNOWN_IMAGE_CONTENT_TYPE) throw new StorageError({ message: 'Unsupported cover image format', operation: 'convertCoverImage' })
        const extension = contentType === 'image/jpeg' ? '.jpg' : contentType === 'image/png' ? '.png' : contentType === 'image/gif' ? '.gif' : '.webp'
        const slash = pathname.lastIndexOf('/')
        const dot = pathname.lastIndexOf('.')
        const storedPath = dot > slash ? `${pathname.slice(0, dot)}${extension}` : `${pathname}${extension}`
        await env.BLOB.put(storedPath, data, { httpMetadata: { contentType } })
        return metadata(env.BLOB, storedPath, contentType)
      },
      catch: error => error instanceof StorageError ? error : new StorageError({ message: String(error), operation: 'putCoverImage' })
    }),
    get: pathname => Effect.tryPromise({
      try: async () => {
        const object = await env.BLOB.get(pathname)
        return object ? new Blob([await object.arrayBuffer()], { type: object.httpMetadata?.contentType }) : null
      },
      catch: error => new StorageError({ message: String(error), operation: 'get' })
    }),
    delete: pathname => Effect.tryPromise({ try: () => env.BLOB.delete(pathname), catch: error => new StorageError({ message: String(error), operation: 'delete' }) }),
    list: prefix => Effect.tryPromise({
      try: async () => (await env.BLOB.list({ prefix })).objects.map(object => ({ pathname: object.key, contentType: object.httpMetadata?.contentType, size: object.size, uploadedAt: object.uploaded ?? new Date() })),
      catch: error => new StorageError({ message: String(error), operation: 'list' })
    }),
    getUsage: () => Effect.succeed({ available: false, totalBytes: 0, objectCount: 0 })
  })
  const infrastructure = Layer.mergeAll(db, storage, FetchHttpClient.layer)
  return Layer.provideMerge(
    Layer.mergeAll(BookRepositoryLive, BookEnrichmentRepositoryLive, CanonicalBookEnrichmentRepositoryLive, OpenLibraryRepositoryLive),
    infrastructure
  )
}

import { Effect, Layer } from 'effect'
import { blob } from '@nuxthub/blob'
import { StorageError, StorageService } from '../../services/storage.service'
import type { BlobMetadata } from '../../services/storage.service'

function toMetadata(result: {
  pathname: string
  contentType?: string
  size?: number
  uploadedAt: Date | string
}): BlobMetadata {
  return {
    pathname: result.pathname,
    contentType: result.contentType,
    size: result.size,
    uploadedAt: result.uploadedAt instanceof Date ? result.uploadedAt : new Date(result.uploadedAt)
  }
}

function detectImageContentType(data: Buffer | ArrayBuffer) {
  const bytes = Buffer.isBuffer(data)
    ? data
    : Buffer.from(new Uint8Array(data))

  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return 'image/jpeg'
  }
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png'
  }
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }
  if (bytes.subarray(0, 6).toString('ascii').startsWith('GIF')) {
    return 'image/gif'
  }
  return 'application/octet-stream'
}

function extensionForContentType(contentType: string) {
  switch (contentType) {
    case 'image/jpeg':
      return '.jpg'
    case 'image/png':
      return '.png'
    case 'image/webp':
      return '.webp'
    case 'image/gif':
      return '.gif'
    default:
      return null
  }
}

function pathnameForStoredCover(pathname: string, contentType: string) {
  const extension = extensionForContentType(contentType)
  if (!extension) {
    return pathname
  }

  const lastSlash = pathname.lastIndexOf('/')
  const lastDot = pathname.lastIndexOf('.')
  if (lastDot > lastSlash) {
    return `${pathname.slice(0, lastDot)}${extension}`
  }
  return `${pathname}${extension}`
}

export const StorageServiceCloudflareLive = Layer.succeed(StorageService, {
  put: (pathname, data, options) =>
    Effect.tryPromise({
      try: () => blob.put(pathname, data, {
        contentType: options?.contentType,
        prefix: options?.prefix
      }).then(toMetadata),
      catch: error => new StorageError({
        message: `Failed to put blob: ${error}`,
        operation: 'put'
      })
    }),

  putCoverImage: (pathname, data) =>
    Effect.tryPromise({
      try: () => {
        const contentType = detectImageContentType(data)
        return blob.put(pathnameForStoredCover(pathname, contentType), data, {
          contentType
        }).then(toMetadata)
      },
      catch: error => new StorageError({
        message: `Failed to put cover image blob: ${error}`,
        operation: 'putCoverImage'
      })
    }),

  get: pathname =>
    Effect.tryPromise({
      try: () => blob.get(pathname),
      catch: error => new StorageError({
        message: `Failed to get blob: ${error}`,
        operation: 'get'
      })
    }),

  delete: pathname =>
    Effect.tryPromise({
      try: () => blob.delete(pathname),
      catch: error => new StorageError({
        message: `Failed to delete blob: ${error}`,
        operation: 'delete'
      })
    }),

  list: prefix =>
    Effect.tryPromise({
      try: async () => {
        const results = await blob.list({ prefix })
        return results.blobs.map(toMetadata)
      },
      catch: error => new StorageError({
        message: `Failed to list blobs: ${error}`,
        operation: 'list'
      })
    })
})

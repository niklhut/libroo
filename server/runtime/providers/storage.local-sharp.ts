import { Effect, Layer } from 'effect'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, relative, resolve, win32 } from 'node:path'
import sharp from 'sharp'
import { StorageError, StorageService } from '../../services/storage.service'
import type { BlobMetadata, BlobPutOptions } from '../../services/storage.service'

interface LocalBlobMetadata extends BlobMetadata {
  contentType: string
}

function getLocalStorageRoot() {
  return process.env.NUXT_LOCAL_STORAGE_DIR
    || process.env.LIBROO_LOCAL_STORAGE_DIR
    || '.data/blob'
}

function assertSafePathname(pathname: string) {
  const normalized = normalize(pathname)
  const windowsNormalized = win32.normalize(pathname)

  if (
    normalized.includes('\0')
    || isAbsolute(normalized)
    || win32.isAbsolute(pathname)
    || normalized === '..'
    || normalized.startsWith('../')
    || normalized.startsWith('..\\')
    || windowsNormalized === '..'
    || windowsNormalized.startsWith('..\\')
  ) {
    throw new Error(`Unsafe blob pathname: ${pathname}`)
  }
  return normalized
}

function resolveBlobPath(pathname: string) {
  const root = resolve(getLocalStorageRoot())
  const candidate = resolve(root, assertSafePathname(pathname))
  const relativePath = relative(root, candidate)
  if (
    relativePath === '..'
    || relativePath.startsWith('../')
    || relativePath.startsWith('..\\')
    || isAbsolute(relativePath)
  ) {
    throw new Error(`Unsafe blob pathname: ${pathname}`)
  }

  return candidate
}

function metadataPath(pathname: string) {
  return `${resolveBlobPath(pathname)}.meta.json`
}

function detectContentType(pathname: string, fallback?: string) {
  if (fallback) {
    return fallback
  }
  if (pathname.endsWith('.webp')) {
    return 'image/webp'
  }
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) {
    return 'image/jpeg'
  }
  if (pathname.endsWith('.png')) {
    return 'image/png'
  }
  if (pathname.endsWith('.gif')) {
    return 'image/gif'
  }
  return 'application/octet-stream'
}

async function readMetadata(pathname: string): Promise<LocalBlobMetadata | null> {
  try {
    const raw = await readFile(metadataPath(pathname), 'utf8')
    const parsed = JSON.parse(raw) as Omit<LocalBlobMetadata, 'uploadedAt'> & { uploadedAt: string }
    return {
      ...parsed,
      uploadedAt: new Date(parsed.uploadedAt)
    }
  } catch {
    return null
  }
}

async function writeBlob(pathname: string, data: Buffer | Blob | ArrayBuffer, options?: BlobPutOptions) {
  const blobPath = resolveBlobPath(pathname)
  await mkdir(dirname(blobPath), { recursive: true })

  const buffer = data instanceof Blob
    ? Buffer.from(await data.arrayBuffer())
    : Buffer.isBuffer(data)
      ? data
      : Buffer.from(new Uint8Array(data))

  await writeFile(blobPath, buffer)

  const metadata: LocalBlobMetadata = {
    pathname,
    contentType: detectContentType(pathname, options?.contentType),
    size: buffer.length,
    uploadedAt: new Date()
  }
  await writeFile(metadataPath(pathname), JSON.stringify({
    ...metadata,
    uploadedAt: metadata.uploadedAt.toISOString()
  }, null, 2))

  return metadata
}

async function listFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = join(current, entry.name)
    if (entry.isDirectory()) {
      return listFiles(root, entryPath)
    }
    if (entry.name.endsWith('.meta.json')) {
      return []
    }
    return [relative(root, entryPath)]
  }))
  return files.flat()
}

export const StorageServiceLocalSharpLive = Layer.succeed(StorageService, {
  put: (pathname, data, options) =>
    Effect.tryPromise({
      try: () => writeBlob(pathname, data, options),
      catch: error => new StorageError({
        message: `Failed to put local blob: ${error}`,
        operation: 'put'
      })
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

      return yield* Effect.tryPromise({
        try: () => writeBlob(pathname, webpBuffer, { contentType: 'image/webp' }),
        catch: error => new StorageError({
          message: `Failed to put local cover image blob: ${error}`,
          operation: 'putCoverImage'
        })
      })
    }),

  get: pathname =>
    Effect.tryPromise({
      try: async () => {
        const metadata = await readMetadata(pathname)
        const buffer = await readFile(resolveBlobPath(pathname)).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') {
            return null
          }
          throw error
        })
        return buffer ? new Blob([buffer], { type: metadata?.contentType ?? detectContentType(pathname) }) : null
      },
      catch: error => new StorageError({
        message: `Failed to get local blob: ${error}`,
        operation: 'get'
      })
    }),

  delete: pathname =>
    Effect.tryPromise({
      try: async () => {
        await rm(resolveBlobPath(pathname), { force: true })
        await rm(metadataPath(pathname), { force: true })
      },
      catch: error => new StorageError({
        message: `Failed to delete local blob: ${error}`,
        operation: 'delete'
      })
    }),

  list: prefix =>
    Effect.tryPromise({
      try: async () => {
        const root = getLocalStorageRoot()
        const files = await listFiles(root)
        const filtered = prefix ? files.filter(file => file.startsWith(prefix)) : files
        return Promise.all(filtered.map(async (pathname) => {
          const metadata = await readMetadata(pathname)
          if (metadata) {
            return metadata
          }
          const stats = await stat(resolveBlobPath(pathname))
          return {
            pathname,
            contentType: detectContentType(pathname),
            size: stats.size,
            uploadedAt: stats.mtime
          }
        }))
      },
      catch: error => new StorageError({
        message: `Failed to list local blobs: ${error}`,
        operation: 'list'
      })
    })
})

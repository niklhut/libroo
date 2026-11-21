import { BlobReader, BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js'
import type { LibraryBackupExport } from '~~/shared/types/library-transfer'

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
const ZIP_METADATA_RESERVE_BYTES = 4 * 1024 * 1024
const COVER_DOWNLOAD_BATCH_SIZE = 4
const COVER_DOWNLOAD_TIMEOUT_MS = 15_000

export async function createLibraryBackup({ csv, covers }: LibraryBackupExport) {
  const csvReader = new TextReader(csv)
  const maxContentBytes = MAX_ARCHIVE_BYTES - ZIP_METADATA_RESERVE_BYTES
  if (csvReader.size > maxContentBytes) throw new Error('The library backup exceeds 512 MB')

  const zip = new ZipWriter(new BlobWriter('application/zip'), { level: 0, useWebWorkers: false })
  const missingCovers: string[] = []
  let bytes = csvReader.size

  for (let offset = 0; offset < covers.length; offset += COVER_DOWNLOAD_BATCH_SIZE) {
    const downloads = await Promise.all(covers.slice(offset, offset + COVER_DOWNLOAD_BATCH_SIZE).map(async ({ file, url }) => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), COVER_DOWNLOAD_TIMEOUT_MS)
      try {
        const response = await fetch(url, { mode: 'same-origin', redirect: 'error', signal: controller.signal })
        if (response.ok && response.headers.get('Content-Type')?.startsWith('image/')) {
          const blob = await response.blob()
          if (blob.size) return { file, blob }
        }
      } catch {
        // An unavailable cover should leave its book in the archive.
      } finally {
        clearTimeout(timeout)
      }
      return { file, blob: null }
    }))

    for (const { file, blob } of downloads) {
      if (!blob) {
        missingCovers.push(file)
        continue
      }
      bytes += blob.size
      if (bytes > maxContentBytes) throw new Error('The library backup exceeds 512 MB')
      await zip.add(file, new BlobReader(blob))
    }
  }

  await zip.add('library.csv', csvReader)
  await zip.add('manifest.json', new TextReader(JSON.stringify({ format: 'libroo-library', version: 1, missingCovers })))
  return { blob: await zip.close(), missingCovers }
}

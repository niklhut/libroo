import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js'
import { afterEach, expect, it, vi } from 'vitest'
import { createLibraryBackup } from '../../app/utils/library-backup'

afterEach(() => vi.unstubAllGlobals())

it('includes all book records and maps available and missing covers', async () => {
  const fetchCover = vi.fn()
    .mockResolvedValueOnce(new Response('image', { headers: { 'Content-Type': 'image/webp' } }))
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
  vi.stubGlobal('fetch', fetchCover)

  const csv = 'title,cover_file\nAvailable,covers/1.webp\nMissing,covers/2.webp\nCoverless,'
  const { blob, missingCovers } = await createLibraryBackup({
    csv,
    covers: [
      { file: 'covers/1.webp', url: '/api/blob/covers/available.webp' },
      { file: 'covers/2.webp', url: '/api/blob/covers/missing.webp' }
    ]
  })
  const zip = new ZipReader(new BlobReader(blob), { useWebWorkers: false })
  try {
    const entries = await zip.getEntries()
    const files = new Map<string, string>()
    for (const entry of entries) {
      if (!entry.directory) files.set(entry.filename, await entry.getData(new TextWriter()))
    }
    expect(files.get('library.csv')).toBe(csv)
    expect(files.get('covers/1.webp')).toBe('image')
    expect(files.has('covers/2.webp')).toBe(false)
    expect(missingCovers).toEqual(['covers/2.webp'])
    expect(JSON.parse(files.get('manifest.json')!)).toEqual({
      format: 'libroo-library', version: 1, missingCovers
    })
  } finally {
    await zip.close()
  }
})

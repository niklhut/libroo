import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js'
import { afterEach, expect, it, vi } from 'vitest'
import { createLibraryBackup } from '../../app/utils/library-backup'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

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

it('finishes the archive when a cover response stalls while reading its body', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const fetchCover = vi.fn<typeof fetch>(async (_url, options) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(1))
        const signal = options?.signal
        signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true })
      }
    })
    return new Response(body, { headers: { 'Content-Type': 'image/webp' } })
  })
  vi.stubGlobal('fetch', fetchCover)

  const csv = 'title,cover_file\nStalled,covers/1.webp'
  const archive = createLibraryBackup({
    csv,
    covers: [{ file: 'covers/1.webp', url: '/api/blob/covers/stalled.webp' }]
  })
  expect(fetchCover).toHaveBeenCalledWith('/api/blob/covers/stalled.webp', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  await vi.advanceTimersByTimeAsync(15_000)
  vi.useRealTimers()

  const { blob, missingCovers } = await archive
  expect(missingCovers).toEqual(['covers/1.webp'])
  const zip = new ZipReader(new BlobReader(blob), { useWebWorkers: false })
  try {
    const entries = await zip.getEntries()
    expect(entries.map(entry => entry.filename)).toEqual(['library.csv', 'manifest.json'])
    const manifest = entries.find(entry => entry.filename === 'manifest.json')
    if (!manifest || manifest.directory) throw new Error('Expected a manifest file')
    expect(JSON.parse(await manifest.getData(new TextWriter()))).toMatchObject({ missingCovers })
  } finally {
    await zip.close()
  }
})

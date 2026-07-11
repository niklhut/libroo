export type ImageContentType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'

export const UNKNOWN_IMAGE_CONTENT_TYPE = 'application/octet-stream' as const

export function detectImageContentType(data: Buffer | ArrayBuffer): ImageContentType | typeof UNKNOWN_IMAGE_CONTENT_TYPE {
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
  const gifSignature = bytes.subarray(0, 6).toString('ascii')
  if (gifSignature === 'GIF87a' || gifSignature === 'GIF89a') {
    return 'image/gif'
  }
  return UNKNOWN_IMAGE_CONTENT_TYPE
}

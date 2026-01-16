import { z } from 'zod'

/**
 * Validate ISBN-10 check digit
 * The check digit is calculated such that the sum of all digits
 * (each multiplied by its position 1-10) is divisible by 11.
 */
function isValidIsbn10Checksum(isbn: string): boolean {
  if (isbn.length !== 10) return false

  let sum = 0
  for (let i = 0; i < 10; i++) {
    const char = isbn[i]
    const digit = char === 'X' ? 10 : Number.parseInt(char!, 10)
    if (Number.isNaN(digit)) return false
    sum += digit * (10 - i)
  }

  return sum % 11 === 0
}

/**
 * Validate ISBN-13 check digit
 * The check digit is calculated such that the sum of all digits
 * (alternating weights of 1 and 3) is divisible by 10.
 */
function isValidIsbn13Checksum(isbn: string): boolean {
  if (isbn.length !== 13) return false

  let sum = 0
  for (let i = 0; i < 13; i++) {
    const digit = Number.parseInt(isbn[i]!, 10)
    if (Number.isNaN(digit)) return false
    sum += digit * (i % 2 === 0 ? 1 : 3)
  }

  return sum % 10 === 0
}

/**
 * Extract and normalize a valid ISBN from input string.
 * Handles:
 * - ISBN-10 with X check digit (e.g., "054792822X")
 * - Price barcodes (e.g., "9781234567890 59099")
 * - Hyphens and spaces
 *
 * Note: Checksum validation is performed but invalid checksums are still
 * passed through - the backend lookup is the ultimate source of truth.
 */
export function extractIsbn(input: string): string | null {
  // Normalize: uppercase and remove hyphens/spaces
  const normalized = input.toUpperCase().replace(/[-\s]/g, '')

  // Check for valid ISBN-10 (9 digits + digit or X)
  if (normalized.length === 10) {
    if (/^\d{9}[\dX]$/.test(normalized)) {
      // Validate checksum but still return even if invalid
      // Backend lookup will ultimately determine validity
      if (!isValidIsbn10Checksum(normalized)) {
        // eslint-disable-next-line no-console
        console.debug(`ISBN-10 checksum invalid: ${normalized}`)
      }
      return normalized
    }
  }

  // Check for valid ISBN-13 (13 digits starting with 978 or 979)
  if (normalized.length === 13) {
    if (/^97[89]\d{10}$/.test(normalized)) {
      // Validate checksum but still return even if invalid
      if (!isValidIsbn13Checksum(normalized)) {
        // eslint-disable-next-line no-console
        console.debug(`ISBN-13 checksum invalid: ${normalized}`)
      }
      return normalized
    }
  }

  // Try to extract ISBN-13 from longer barcode (price code suffix)
  const digits = normalized.replace(/\D/g, '')
  if (digits.length >= 13) {
    const isbn13Match = digits.match(/^(97[89]\d{10})/)
    if (isbn13Match && isbn13Match[1]) {
      return isbn13Match[1]
    }
  }

  // Fallback: return original if it looks like it could be an ISBN
  // Let the backend lookup handle further validation
  if (normalized.length >= 10 && normalized.length <= 13) {
    return normalized
  }

  return null
}

export const bookIsbnSchema = z.object({
  isbn: z.string({ error: 'ISBN is required' })
    // Normalize first, then validate length on the extracted ISBN
    .transform((val) => {
      // Normalize: remove hyphens and spaces
      const normalized = val.replace(/[-\s]/g, '')
      // Try to extract valid ISBN from potential price barcode
      const extracted = extractIsbn(normalized)
      return extracted || normalized
    })
    .pipe(
      z.string()
        .min(10, { error: 'ISBN must be at least 10 characters' })
        .max(13, { error: 'ISBN is too long' })
    )
})

export type BookIsbnSchema = z.infer<typeof bookIsbnSchema>

export const bookBatchDeleteSchema = z.object({
  ids: z.array(z.string({ error: 'ID must be a string' })).min(1, { error: 'At least one ID is required' })
})

export type BookBatchDeleteSchema = z.infer<typeof bookBatchDeleteSchema>

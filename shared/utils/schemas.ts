import { z } from 'zod'

/**
 * Extract and normalize a valid ISBN from input string.
 * Handles:
 * - ISBN-10 with X check digit (e.g., "054792822X")
 * - Price barcodes (e.g., "9781234567890 59099")
 * - Hyphens and spaces
 */
export function extractIsbn(input: string): string | null {
  // Normalize: uppercase and remove hyphens/spaces
  const normalized = input.toUpperCase().replace(/[-\s]/g, '')

  // Check for valid ISBN-10 (9 digits + digit or X)
  if (normalized.length === 10) {
    if (/^\d{9}[\dX]$/.test(normalized)) {
      return normalized
    }
  }

  // Check for valid ISBN-13 (13 digits starting with 978 or 979)
  if (normalized.length === 13) {
    if (/^97[89]\d{10}$/.test(normalized)) {
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
    .min(10, { error: 'ISBN must be at least 10 characters' })
    .max(17, { error: 'ISBN is too long' })
    .transform(val => {
      // Normalize: remove hyphens and spaces
      const normalized = val.replace(/[-\s]/g, '')
      // Try to extract valid ISBN from potential price barcode
      const extracted = extractIsbn(normalized)
      return extracted || normalized
    })
})

export type BookIsbnSchema = z.infer<typeof bookIsbnSchema>

export const bookBatchDeleteSchema = z.object({
  ids: z.array(z.string({ error: 'ID must be a string' })).min(1, { error: 'At least one ID is required' })
})

export type BookBatchDeleteSchema = z.infer<typeof bookBatchDeleteSchema>

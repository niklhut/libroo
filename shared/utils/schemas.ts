import { z } from 'zod'
import {
  normalizeTagInputText,
  TAG_INPUT_ALLOWED_CHARACTERS,
  TAG_INPUT_MAX_LENGTH,
  TAG_INPUT_MIN_LENGTH
} from './tag-ingestion'

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

export const bookTagAddSchema = z.object({
  name: z.string({ error: 'Tag name is required' })
    .transform(value => normalizeTagInputText(value))
    .pipe(
      z.string()
        .min(TAG_INPUT_MIN_LENGTH, { error: 'Tag name is too short' })
        .max(TAG_INPUT_MAX_LENGTH, { error: 'Tag name is too long' })
        .refine(value => !value.toLowerCase().startsWith('nyt:'), { error: 'Tag name is invalid' })
        .refine(value => !value.toLowerCase().includes('http://') && !value.toLowerCase().includes('https://'), { error: 'Tag name is invalid' })
        .refine(value => !/^\d+$/.test(value), { error: 'Tag name must contain a letter' })
        .refine(value => /[a-zA-Z]/.test(value), { error: 'Tag name must contain a letter' })
        .refine(value => TAG_INPUT_ALLOWED_CHARACTERS.test(value), { error: 'Tag name contains invalid characters' })
    )
})

export type BookTagAddSchema = z.infer<typeof bookTagAddSchema>

export const bookRatingSchema = z.object({
  rating: z.number({ error: 'Rating must be a number' })
    .int({ error: 'Rating must be a whole number' })
    .min(1, { error: 'Rating must be at least 1' })
    .max(5, { error: 'Rating must be at most 5' })
    .nullable()
})

export type BookRatingSchema = z.infer<typeof bookRatingSchema>

export const bookNoteSchema = z.object({
  note: z.preprocess(
    (val) => {
      if (typeof val === 'string') {
        const trimmed = val.trim()
        return trimmed === '' ? null : trimmed
      }
      return val
    },
    z.string({ error: 'Note must be a string' }).nullable()
  )
})

export type BookNoteSchema = z.infer<typeof bookNoteSchema>

const nullableDateSchema = z.preprocess(
  (val) => {
    if (val === '' || val === undefined) return val
    if (val === null || val instanceof Date) return val
    if (typeof val === 'string') {
      const date = new Date(val)
      return Number.isNaN(date.getTime()) ? val : date
    }
    return val
  },
  z.date({ error: 'Date must be valid' }).nullable().optional()
)

const localNullableDateSchema = z.preprocess(
  (val) => {
    if (val === '') return undefined
    if (val === undefined) return val
    if (val === null || val instanceof Date) return val
    if (typeof val === 'string') {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(val)
        ? new Date(`${val}T00:00:00`)
        : new Date(val)
      return Number.isNaN(date.getTime()) ? val : date
    }
    return val
  },
  z.date({ error: 'Date must be valid' }).nullable().optional()
)

function toLocalDateKey(date: Date): number {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()
}

export const bookReadingProgressSchema = z.object({
  status: z.enum(['unread', 'reading', 'read'], { error: 'Reading status is invalid' }).optional(),
  currentPage: z.number({ error: 'Current page must be a number' })
    .int({ error: 'Current page must be a whole number' })
    .min(0, { error: 'Current page cannot be negative' })
    .nullable()
    .optional(),
  progressPercent: z.number({ error: 'Progress must be a number' })
    .int({ error: 'Progress must be a whole number' })
    .min(0, { error: 'Progress cannot be negative' })
    .max(100, { error: 'Progress cannot be greater than 100' })
    .nullable()
    .optional(),
  startedAt: nullableDateSchema,
  finishedAt: nullableDateSchema
}).refine(
  value => Object.values(value).some(item => item !== undefined),
  { error: 'At least one reading progress field is required' }
)

export type BookReadingProgressSchema = z.infer<typeof bookReadingProgressSchema>

export const createLoanSchema = z.object({
  borrowerDisplayName: z.string({ error: 'Borrower name is required' })
    .trim()
    .min(1, { error: 'Borrower name is required' })
    .max(120, { error: 'Borrower name is too long' }),
  borrowerEmail: z.preprocess(
    (val) => {
      if (typeof val !== 'string') return val
      const trimmed = val.trim()
      return trimmed === '' ? null : trimmed
    },
    z.email({ error: 'Borrower email must be valid' }).nullable().optional()
  ),
  dueAt: localNullableDateSchema
}).refine((value) => {
  if (!value.dueAt) return true
  return toLocalDateKey(value.dueAt) >= toLocalDateKey(new Date())
}, {
  path: ['dueAt'],
  error: 'Due date cannot be in the past'
})

export type CreateLoanSchema = z.infer<typeof createLoanSchema>

export const removeBookSchema = z.object({
  confirmActiveLoan: z.boolean().default(false).optional()
})

export type RemoveBookSchema = z.infer<typeof removeBookSchema>

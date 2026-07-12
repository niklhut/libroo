import { z } from 'zod'
import {
  normalizeTagInputText,
  TAG_INPUT_ALLOWED_CHARACTERS,
  TAG_INPUT_MAX_LENGTH,
  TAG_INPUT_MIN_LENGTH
} from './tag-ingestion'
import {
  LIBRARY_CSV_MAX_BYTES
} from './library-transfer-csv'
import {
  BOOK_LOCATION_MAX_LENGTH,
  BOOK_LOCATION_NAME_MAX_LENGTH,
  BOOK_LOCATION_PATH_SEPARATOR_PATTERN,
  normalizeBookLocationName,
  normalizeBookLocationPath
} from './book-location'

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

export const libraryStateSchema = z.enum(['owned', 'wishlisted', 'previously_owned'], { error: 'Library state is invalid' })

export const bookIsbnAddSchema = bookIsbnSchema.extend({
  libraryState: libraryStateSchema.optional().default('owned')
})

export type BookIsbnAddSchema = z.infer<typeof bookIsbnAddSchema>

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

export const bookLocationSchema = z.object({
  locationId: z.string({ error: 'Location ID must be a string' }).nullable()
})

export type BookLocationSchema = z.infer<typeof bookLocationSchema>

export const locationCreateSchema = z.object({
  name: z.preprocess(
    (val) => {
      if (typeof val === 'string') {
        return normalizeBookLocationName(val)
      }
      return val
    },
    z.string({ error: 'Location name must be a string' })
      .min(1, { error: 'Location name is required' })
      .max(BOOK_LOCATION_NAME_MAX_LENGTH, { error: 'Location name is too long' })
      .refine(value => !BOOK_LOCATION_PATH_SEPARATOR_PATTERN.test(value), {
        error: 'Location name contains reserved path separators'
      })
  ),
  parentLocationId: z.preprocess(
    (val) => {
      if (val === undefined || val === null) return null
      if (typeof val === 'string') return val.trim()
      return val
    },
    z.string({ error: 'Parent location ID must be a string' })
      .min(1, { error: 'Parent location ID is required' })
      .nullable()
  ).default(null)
})

export type LocationCreateSchema = z.infer<typeof locationCreateSchema>

export const locationRenameSchema = z.object({
  name: locationCreateSchema.shape.name
})

export type LocationRenameSchema = z.infer<typeof locationRenameSchema>

export const locationMoveSchema = z.object({
  parentLocationId: z.preprocess(
    (val) => {
      if (val === null) return null
      if (typeof val === 'string') return val.trim()
      return val
    },
    z.string({ error: 'Parent location ID must be a string' })
      .min(1, { error: 'Parent location ID is required' })
      .nullable()
  )
})

export type LocationMoveSchema = z.infer<typeof locationMoveSchema>

export const locationDeleteSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('block')
  }),
  z.object({
    mode: z.literal('clear')
  }),
  z.object({
    mode: z.literal('move'),
    targetLocationId: z.string({ error: 'Target location ID must be a string' }).min(1, { error: 'Target location ID is required' })
  })
])

export type LocationDeleteSchema = z.infer<typeof locationDeleteSchema>

export const locationPathSchema = z.object({
  path: z.preprocess(
    (val) => {
      if (Array.isArray(val) && val.every(item => typeof item === 'string')) {
        return normalizeBookLocationPath(val)
      }
      if (typeof val === 'string') {
        return normalizeBookLocationPath(val)
      }
      return val
    },
    z.string({ error: 'Location path must be a string' })
      .min(1, { error: 'Location path is required' })
      .max(BOOK_LOCATION_MAX_LENGTH, { error: 'Location path is too long' })
  )
})

export type LocationPathSchema = z.infer<typeof locationPathSchema>

export const MANUAL_COVER_MAX_BYTES = 2 * 1024 * 1024
export const MANUAL_COVER_MAX_BASE64_LENGTH = Math.ceil(MANUAL_COVER_MAX_BYTES / 3) * 4
export const MANUAL_COVER_MAX_DATA_URL_PREFIX_LENGTH = 256
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export const stripBase64DataUrlPrefix = (value: string) =>
  value.replace(/^data:[^,]*;base64,/i, '')

export const isCanonicalBase64 = (value: string) => {
  if (!BASE64_PATTERN.test(value)) return false
  if (value.endsWith('==')) return BASE64_ALPHABET.indexOf(value.at(-3)!) % 16 === 0
  if (value.endsWith('=')) return BASE64_ALPHABET.indexOf(value.at(-2)!) % 4 === 0
  return true
}

export const isManualCoverDataWithinLimit = (value: string) => {
  const base64 = stripBase64DataUrlPrefix(value)
  const prefixLength = value.length - base64.length

  return prefixLength <= MANUAL_COVER_MAX_DATA_URL_PREFIX_LENGTH
    && base64.length <= MANUAL_COVER_MAX_BASE64_LENGTH
}

const trimmedNullableString = (maxLength: number, fieldName: string) =>
  z.preprocess(
    (val) => {
      if (val === undefined || val === null) return null
      if (typeof val === 'string') {
        const trimmed = val.trim().replace(/\s+/g, ' ')
        return trimmed === '' ? null : trimmed
      }
      return val
    },
    z.string({ error: `${fieldName} must be a string` })
      .max(maxLength, { error: `${fieldName} is too long` })
      .nullable()
  )

const optionalManualIsbnSchema = z.preprocess(
  (val) => {
    if (val === undefined || val === null) return null
    if (typeof val === 'string') {
      const trimmed = val.trim()
      return trimmed === '' ? null : trimmed
    }
    return val
  },
  z.union([bookIsbnSchema.shape.isbn, z.null()])
)

export const manualBookCreateSchema = z.object({
  title: z.string({ error: 'Title is required' })
    .trim()
    .transform(value => value.replace(/\s+/g, ' '))
    .pipe(
      z.string()
        .min(1, { error: 'Title is required' })
        .max(300, { error: 'Title is too long' })
    ),
  authors: z.array(
    z.string({ error: 'Author must be a string' })
      .trim()
      .transform(value => value.replace(/\s+/g, ' '))
      .pipe(z.string().min(1, { error: 'Author is required' }).max(200, { error: 'Author is too long' }))
  )
    .transform((values) => {
      const seen = new Set<string>()
      return values.filter((value) => {
        const key = value.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    })
    .pipe(z.array(z.string()).min(1, { error: 'At least one author is required' }).max(20, { error: 'Too many authors' })),
  isbn: optionalManualIsbnSchema,
  libraryState: libraryStateSchema.optional().default('owned'),
  coverImage: z.object({
    data: z.string({ error: 'Cover image data is required' })
      .min(1, { error: 'Cover image data is required' })
      .refine(
        isManualCoverDataWithinLimit,
        { error: 'Cover image is too large' }
      )
      .refine(
        value => isCanonicalBase64(stripBase64DataUrlPrefix(value)),
        { error: 'Cover image data must be valid base64' }
      ),
    contentType: z.string({ error: 'Cover image content type is required' })
      .refine(value => value.startsWith('image/'), { error: 'Cover image must be an image' }),
    size: z.number({ error: 'Cover image size must be a number' })
      .int({ error: 'Cover image size must be a whole number' })
      .min(1, { error: 'Cover image is empty' })
      .max(MANUAL_COVER_MAX_BYTES, { error: 'Cover image is too large' })
  }).nullable().optional().default(null),
  publishDate: trimmedNullableString(120, 'Publish date').default(null),
  publisher: trimmedNullableString(240, 'Publisher').default(null),
  numberOfPages: z.number({ error: 'Page count must be a number' })
    .int({ error: 'Page count must be a whole number' })
    .min(1, { error: 'Page count must be at least 1' })
    .max(100000, { error: 'Page count is too large' })
    .nullable()
    .optional()
    .default(null),
  tags: z.array(bookTagAddSchema.shape.name).max(50, { error: 'Too many tags' }).optional().default([]),
  rating: bookRatingSchema.shape.rating.optional().default(null),
  note: bookNoteSchema.shape.note.optional().default(null),
  readingStatus: z.enum(['unread', 'reading', 'read'], { error: 'Reading status is invalid' }).optional().default('unread'),
  currentPage: z.number({ error: 'Current page must be a number' })
    .int({ error: 'Current page must be a whole number' })
    .min(0, { error: 'Current page cannot be negative' })
    .nullable()
    .optional()
    .default(null),
  progressPercent: z.number({ error: 'Progress must be a number' })
    .int({ error: 'Progress must be a whole number' })
    .min(0, { error: 'Progress cannot be negative' })
    .max(100, { error: 'Progress cannot be greater than 100' })
    .nullable()
    .optional()
    .default(null)
}).refine((value) => {
  if (!value.currentPage || !value.numberOfPages) return true
  return value.currentPage <= value.numberOfPages
}, {
  path: ['currentPage'],
  error: 'Current page cannot exceed page count'
})

export type ManualBookCreateSchema = z.infer<typeof manualBookCreateSchema>

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

export const bookLibraryStateSchema = z.object({
  state: libraryStateSchema
})

export type BookLibraryStateSchema = z.infer<typeof bookLibraryStateSchema>

export const preferencesSchema = z.object({
  defaultLibraryStateFilter: z.array(libraryStateSchema).default([])
})

export type PreferencesSchema = z.infer<typeof preferencesSchema>

export const libraryImportSchema = z.object({
  csv: z.string({ error: 'CSV content is required' })
    .min(1, { error: 'CSV content is required' })
    .refine(csv => new TextEncoder().encode(csv).byteLength <= LIBRARY_CSV_MAX_BYTES, {
      error: 'CSV file is too large'
    }),
  conflictStrategy: z.enum(['existing', 'csv'], { error: 'Conflict strategy is invalid' }).default('existing')
})

export type LibraryImportSchema = z.infer<typeof libraryImportSchema>

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

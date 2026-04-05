export interface NormalizedTag {
  key: string
  displayName: string
}

export const TAG_INPUT_MIN_LENGTH = 2
export const TAG_INPUT_MAX_LENGTH = 48
export const TAG_INPUT_ALLOWED_CHARACTERS = /^[\p{L}\p{N}&'\-/. ]+$/u

export const DEFAULT_VAGUE_GENERALITIES = new Set([
  'general',
  'miscellaneous',
  'books',
  'non-fiction',
  'fiction',
  'reference',
  'textbook'
])

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function normalizeTagInputText(input: string): string {
  return collapseWhitespace(input)
    .replace(/^[-,.;:!?()[\]{}"']+|[-,.;:!?()[\]{}"']+$/g, '')
}

function capitalizeWord(word: string): string {
  if (!word) return word

  if (/^[IVXLCDM]+$/i.test(word)) {
    return word.toUpperCase()
  }

  return word[0]!.toUpperCase() + word.slice(1).toLowerCase()
}

export function toSensibleTitleCase(value: string): string {
  return collapseWhitespace(value)
    .split(' ')
    .map((chunk) => {
      const parts = chunk.split(/([/-])/)
      return parts.map((part) => {
        if (part === '/' || part === '-') return part
        return capitalizeWord(part)
      }).join('')
    })
    .join(' ')
}

export function normalizeTagInput(input: string): NormalizedTag | null {
  const cleaned = normalizeTagInputText(input)

  if (!cleaned) return null

  const lowered = cleaned.toLowerCase()

  if (lowered.startsWith('nyt:')) return null
  if (lowered.includes('http://') || lowered.includes('https://')) return null
  if (cleaned.length < TAG_INPUT_MIN_LENGTH || cleaned.length > TAG_INPUT_MAX_LENGTH) return null
  if (/^\d+$/.test(cleaned)) return null
  if (!/[a-zA-Z]/.test(cleaned)) return null
  if (!TAG_INPUT_ALLOWED_CHARACTERS.test(cleaned)) return null

  return {
    key: lowered,
    displayName: toSensibleTitleCase(cleaned)
  }
}

export function splitHierarchicalSubject(input: string): string[] {
  return input
    .split(/\s*(?:\/|--|:)\s*/g)
    .map(segment => collapseWhitespace(segment))
    .filter(Boolean)
}

function looksLikeLibraryCallNumber(value: string): boolean {
  return /^[A-Z]{1,3}\s*\d{1,4}(?:\.\d+)?(?:\s*\.[A-Z]\d*|\s+[A-Z]\d*|\s+[A-Z])?$/i.test(value)
}

export interface TagIngestionOptions {
  vagueGeneralities?: Set<string>
}

export function normalizeSystemTagSegment(segment: string, options?: TagIngestionOptions): NormalizedTag | null {
  const cleaned = normalizeTagInputText(segment)

  if (!cleaned) return null

  const lowered = cleaned.toLowerCase()

  const formatArtifacts = [
    'ebook',
    'pdf',
    'online',
    'downloadable',
    'large print',
    'braille',
    'microform',
    'electronic resource'
  ]

  // These are intentionally broad umbrella subjects that do not help shelf discovery.
  // Callers can override the set via normalizeSystemTagSegment(..., { vagueGeneralities }).
  const vagueGeneralities = options?.vagueGeneralities ?? DEFAULT_VAGUE_GENERALITIES

  const adminCodes = [
    'lcsh',
    'bisac',
    'dewey',
    'classification',
    'catalogs',
    'indexed',
    'bibliography'
  ]

  const providerMetadata = [
    'open library',
    'google books',
    'internet archive',
    'overdrive'
  ]

  if (lowered.includes('http')) return null

  if (formatArtifacts.some(value => lowered.includes(value))) return null
  if (vagueGeneralities.has(lowered)) return null
  if (adminCodes.some(value => lowered.includes(value))) return null
  if (providerMetadata.some(value => lowered.includes(value))) return null

  if (cleaned.length > 40) return null
  if (cleaned.length < 3 && lowered !== 'art') return null

  if (/^[\d.]+$/.test(cleaned)) return null
  if (looksLikeLibraryCallNumber(cleaned)) return null

  if (!/[a-zA-Z]/.test(cleaned)) return null
  if (!/^[\p{L}\p{N}&'\-/. ]+$/u.test(cleaned)) return null

  return {
    key: lowered,
    displayName: toSensibleTitleCase(cleaned)
  }
}

export function normalizeSuggestedTags(values: string[] | undefined, options?: TagIngestionOptions): NormalizedTag[] {
  if (!values || values.length === 0) return []

  const seen = new Set<string>()
  const output: NormalizedTag[] = []

  for (const value of values) {
    const segments = splitHierarchicalSubject(value)

    for (const segment of segments) {
      const normalized = normalizeSystemTagSegment(segment, options)
      if (!normalized) continue
      if (seen.has(normalized.key)) continue
      seen.add(normalized.key)
      output.push(normalized)
      if (output.length >= 20) break
    }

    if (output.length >= 20) break
  }

  return output
}

export interface NormalizedTag {
  key: string
  displayName: string
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
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
  const cleaned = collapseWhitespace(input)
    .replace(/^[-,.;:!?()[\]{}"']+|[-,.;:!?()[\]{}"']+$/g, '')

  if (!cleaned) return null

  const lowered = cleaned.toLowerCase()

  if (lowered.startsWith('nyt:')) return null
  if (lowered.includes('http://') || lowered.includes('https://')) return null
  if (cleaned.length < 2 || cleaned.length > 48) return null
  if (/^\d+$/.test(cleaned)) return null
  if (!/[a-zA-Z]/.test(cleaned)) return null
  if (!/^[\p{L}\p{N}&'\-/. ]+$/u.test(cleaned)) return null

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

export function normalizeSystemTagSegment(segment: string): NormalizedTag | null {
  const cleaned = collapseWhitespace(segment)
    .replace(/^[-,.;:!?()[\]{}"']+|[-,.;:!?()[\]{}"']+$/g, '')

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

  const vagueGeneralities = new Set([
    'general',
    'miscellaneous',
    'books',
    'non-fiction',
    'fiction',
    'reference',
    'textbook'
  ])

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

export function normalizeSuggestedTags(values: string[] | undefined): NormalizedTag[] {
  if (!values || values.length === 0) return []

  const seen = new Set<string>()
  const output: NormalizedTag[] = []

  for (const value of values) {
    const segments = splitHierarchicalSubject(value)

    for (const segment of segments) {
      const normalized = normalizeSystemTagSegment(segment)
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

const ISBN_10_PATTERN = /^\d{9}[\dX]$/
const ISBN_13_PATTERN = /^97[89]\d{10}$/

function validIsbn10(isbn: string) {
  if (!ISBN_10_PATTERN.test(isbn)) return false
  const sum = [...isbn].reduce((total, character, index) => {
    const digit = character === 'X' ? 10 : Number(character)
    return total + digit * (10 - index)
  }, 0)
  return sum % 11 === 0
}

function validIsbn13(isbn: string) {
  if (!ISBN_13_PATTERN.test(isbn)) return false
  const sum = [...isbn].reduce(
    (total, character, index) => total + Number(character) * (index % 2 === 0 ? 1 : 3),
    0
  )
  return sum % 10 === 0
}

export function normalizeIsbnText(value: string) {
  return value.toUpperCase().replace(/[-\s]/g, '')
}

export function isbn10To13(isbn: string) {
  const normalized = normalizeIsbnText(isbn)
  if (!validIsbn10(normalized)) return null
  const body = `978${normalized.slice(0, 9)}`
  const weighted = [...body].reduce(
    (total, character, index) => total + Number(character) * (index % 2 === 0 ? 1 : 3),
    0
  )
  return `${body}${(10 - (weighted % 10)) % 10}`
}

export function isbn13To10(isbn: string) {
  const normalized = normalizeIsbnText(isbn)
  if (!validIsbn13(normalized) || !normalized.startsWith('978')) return null
  const body = normalized.slice(3, 12)
  const weighted = [...body].reduce(
    (total, character, index) => total + Number(character) * (10 - index),
    0
  )
  const check = (11 - (weighted % 11)) % 11
  if (check === 10) return `${body}X`
  return `${body}${check}`
}

export function isValidIsbn(value: string) {
  const normalized = normalizeIsbnText(value)
  return validIsbn10(normalized) || validIsbn13(normalized)
}

/**
 * Returns the stable edition identity used for persistence and matching.
 * Valid ISBN-10 values are represented by their equivalent ISBN-13.
 * Invalid-but-present input is normalized but remains distinguishable.
 */
export function normalizeIsbnIdentity(value: string) {
  const normalized = normalizeIsbnText(value)
  return isbn10To13(normalized) ?? normalized
}

export function isbnIdentityAliases(value: string) {
  const identity = normalizeIsbnIdentity(value)
  const isbn10 = isbn13To10(identity)
  return isbn10 ? [identity, isbn10] : [identity]
}

export const libraryCsvColumns = [
  'title',
  'authors',
  'isbn',
  'tags',
  'location',
  'library_state',
  'reading_status',
  'current_page',
  'progress_percent',
  'rating',
  'note',
  'added_date',
  'active_loan_status',
  'active_loan_borrower',
  'active_loan_loaned_at',
  'active_loan_due_at'
] as const

export type LibraryCsvColumn = typeof libraryCsvColumns[number]
export type LibraryCsvRow = Record<LibraryCsvColumn, string>

export const LIBRARY_CSV_MAX_BYTES = 10 * 1024 * 1024
export const LIBRARY_CSV_MAX_DATA_ROWS = 10_000
export const LIBRARY_CSV_MAX_CELL_LENGTH = 10_000
export const LIBRARY_CSV_MAX_LIST_ITEMS = 50
export const LIBRARY_CSV_MAX_LIST_ITEM_LENGTH = 48

const formulaTriggerPattern = /^[=+@\t\r-]/

function stripFormulaNeutralization(value: string): string {
  return value.startsWith('\'') && formulaTriggerPattern.test(value[1] ?? '')
    ? value.slice(1)
    : value
}

export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return ''

  const text = value instanceof Date ? value.toISOString() : String(value)
  const escapedText = formulaTriggerPattern.test(text) ? `'${text}` : text
  if (!/[",\n\r]/.test(escapedText)) return escapedText

  return `"${escapedText.replaceAll('"', '""')}"`
}

export function formatLibraryCsv(rows: LibraryCsvRow[]): string {
  return [
    libraryCsvColumns.map(escapeCsvValue).join(','),
    ...rows.map(row => libraryCsvColumns.map(column => escapeCsvValue(row[column])).join(','))
  ].join('\n')
}

export function formatCsvList(values: string[]): string {
  return JSON.stringify(values)
}

export function parseCsvList(value: string, fieldName = 'list items'): string[] {
  const trimmed = value.trim()
  if (!trimmed) return []

  let items: string[]
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) {
      throw new Error('CSV list field must be an array of strings')
    }
    items = parsed.map(item => item.trim()).filter(Boolean)
  } else {
    items = trimmed.split(';').map(item => item.trim()).filter(Boolean)
  }

  if (items.length > LIBRARY_CSV_MAX_LIST_ITEMS) {
    throw new Error(`Too many ${fieldName} in row (maximum ${LIBRARY_CSV_MAX_LIST_ITEMS})`)
  }
  if (items.some(item => item.length > LIBRARY_CSV_MAX_LIST_ITEM_LENGTH)) {
    throw new Error(`${fieldName} item is too long (maximum ${LIBRARY_CSV_MAX_LIST_ITEM_LENGTH} characters)`)
  }

  return items
}

function* parseCsvRecords(csv: string): Generator<string[]> {
  let field = ''
  let record: string[] = []
  let inQuotes = false

  for (let index = 0; index < csv.length; index++) {
    const char = csv[index]
    const next = csv[index + 1]

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"'
        index++
      } else if (char === '"') {
        inQuotes = false
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      record.push(field)
      field = ''
    } else if (char === '\n') {
      record.push(field)
      yield record
      record = []
      field = ''
    } else if (char === '\r') {
      if (next === '\n') index++
      record.push(field)
      yield record
      record = []
      field = ''
    } else {
      field += char
    }
  }

  if (inQuotes) {
    throw new Error('CSV contains an unterminated quoted field')
  }

  if (field.length > 0 || record.length > 0) {
    record.push(field)
    yield record
  }
}

export function* parseLibraryCsvRows(csv: string): Generator<LibraryCsvRow> {
  let headerIndexes: Map<string, number> | undefined
  let dataRowCount = 0

  for (const row of parseCsvRecords(csv)) {
    if (!row.some(value => value.trim() !== '')) continue

    if (!headerIndexes) {
      const parsedHeaderIndexes = new Map(row.map((column, index) => [column.replace(/^\uFEFF/, '').trim(), index]))
      headerIndexes = parsedHeaderIndexes
      const legacyOptionalColumns = new Set<LibraryCsvColumn>(['library_state'])
      const missingColumns = libraryCsvColumns.filter(column => !legacyOptionalColumns.has(column) && !parsedHeaderIndexes.has(column))
      if (missingColumns.length > 0) {
        throw new Error(`CSV is missing required columns: ${missingColumns.join(', ')}`)
      }
      continue
    }

    dataRowCount++
    if (dataRowCount > LIBRARY_CSV_MAX_DATA_ROWS) {
      throw new Error(`CSV has too many data rows (maximum ${LIBRARY_CSV_MAX_DATA_ROWS})`)
    }

    const parsed = {} as LibraryCsvRow
    for (const column of libraryCsvColumns) {
      const index = headerIndexes?.get(column)
      const value = index === undefined ? '' : stripFormulaNeutralization(row[index] ?? '')
      if (value.length > LIBRARY_CSV_MAX_CELL_LENGTH) {
        throw new Error(`CSV column ${column} is too long (maximum ${LIBRARY_CSV_MAX_CELL_LENGTH} characters)`)
      }
      parsed[column] = value
    }
    yield parsed
  }
}

export function parseLibraryCsv(csv: string): LibraryCsvRow[] {
  return [...parseLibraryCsvRows(csv)]
}

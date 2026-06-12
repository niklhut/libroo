export const libraryCsvColumns = [
  'title',
  'authors',
  'isbn',
  'tags',
  'location',
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

export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return ''

  const text = value instanceof Date ? value.toISOString() : String(value)
  if (!/[",\n\r]/.test(text)) return text

  return `"${text.replaceAll('"', '""')}"`
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

export function parseCsvList(value: string): string[] {
  const trimmed = value.trim()
  if (!trimmed) return []

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) {
      throw new Error('CSV list field must be an array of strings')
    }
    return parsed.map(item => item.trim()).filter(Boolean)
  }

  return trimmed.split(';').map(item => item.trim()).filter(Boolean)
}

export function parseLibraryCsv(csv: string): LibraryCsvRow[] {
  const records: string[][] = []
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
      records.push(record)
      record = []
      field = ''
    } else if (char === '\r') {
      if (next === '\n') index++
      record.push(field)
      records.push(record)
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
    records.push(record)
  }

  const [header, ...dataRows] = records.filter(row => row.some(value => value.trim() !== ''))
  if (!header) return []

  const headerIndexes = new Map(header.map((column, index) => [column.replace(/^\uFEFF/, '').trim(), index]))
  const missingColumns = libraryCsvColumns.filter(column => !headerIndexes.has(column))
  if (missingColumns.length > 0) {
    throw new Error(`CSV is missing required columns: ${missingColumns.join(', ')}`)
  }

  return dataRows.map((row) => {
    const parsed = {} as LibraryCsvRow
    for (const column of libraryCsvColumns) {
      parsed[column] = row[headerIndexes.get(column)!] ?? ''
    }
    return parsed
  })
}

export interface LibraryBook {
  id: string
  bookId: string
  title: string
  author: string
  isbn: string | null
  coverPath: string | null
  addedAt: Date | string
}

export interface BookLookupResult {
  found: boolean
  isbn: string
  title?: string
  author?: string
  coverUrl?: string | null
  description?: string
  subjects?: string[] | null
  publishDate?: string
  publishers?: string[] | null
  numberOfPages?: number
  existsLocally?: boolean
  message?: string
}

export interface BatchDeleteResult {
  removedIds: string[]
  failedIds: string[]
}

export interface BookDetails {
  id: string
  bookId: string
  title: string
  author: string
  isbn: string | null
  coverPath: string | null
  description: string | null
  subjects: string[] | null
  publishDate: string | null
  publishers: string | null
  numberOfPages: number | null
  openLibraryKey: string | null
  workKey: string | null
  addedAt: Date | string
}

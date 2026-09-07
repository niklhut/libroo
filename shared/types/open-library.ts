/** Edition metadata retained for subsequent enrichment and retries. */
export interface OpenLibraryBookData {
  title: string
  authors: string[]
  isbn: string
  openLibraryKey: string
  workKey: string | null
  coverUrl: string | null
  coverId?: number
  description?: string
  subjects?: string[]
  publishDate?: string
  publishers?: string[]
  numberOfPages?: number
}

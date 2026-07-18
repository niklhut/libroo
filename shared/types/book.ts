export interface BookAuthor {
  id: string
  name: string
}

export interface LibraryBook {
  id: string
  bookId: string
  libraryState: LibraryState
  title: string
  author: string
  authors?: BookAuthor[]
  isbn: string | null
  coverPath: string | null
  location: BookLocation | null
  lastKnownLocation?: string | null
  tags?: string[]
  addedAt: Date | string
  activeLoan?: ActiveLoanSummary | null
}

export interface BookTag {
  id: string
  name: string
}

export interface TagWithCount {
  id: string
  name: string
  bookCount: number
}

export interface BookLocation {
  id: string
  name: string
  parentLocationId: string | null
  path: string
  depth: number
}

export interface BookLocationWithCount extends BookLocation {
  bookCount: number
  directBookCount: number
  descendantBookCount: number
}

export interface BookLocationTreeNode extends BookLocationWithCount {
  children: BookLocationTreeNode[]
}

export type ReadingStatus = 'unread' | 'reading' | 'read'
export type LibraryState = 'owned' | 'wishlisted' | 'previously_owned'

export interface ReadingProgress {
  status: ReadingStatus
  currentPage: number | null
  progressPercent: number | null
  startedAt: Date | string | null
  finishedAt: Date | string | null
}

export interface BookLookupResult {
  found: boolean
  isbn: string
  title?: string
  author?: string
  authors?: string[]
  coverUrl?: string | null
  description?: string
  subjects?: string[] | null
  publishDate?: string
  publishers?: string[] | null
  numberOfPages?: number
  existsLocally?: boolean
  existingUserBookId?: string | null
  existingState?: LibraryState | null
  message?: string
}

interface BulkBookLookupItemBase {
  inputIndex: number
  input: string
  normalizedIsbn: string | null
  duplicateOf?: number
}

export type BulkBookLookupItem
  = | BulkBookLookupItemBase & {
    status: 'ok'
    normalizedIsbn: string
    result: BookLookupResult
  }
  | BulkBookLookupItemBase & {
    status: 'invalid'
    normalizedIsbn: null
    message: string
  }
  | BulkBookLookupItemBase & {
    status: 'error'
    normalizedIsbn: string
    errorCode: 'upstream_failure' | 'persistence_failure'
    message: string
  }

export interface BulkBookLookupResponse {
  items: BulkBookLookupItem[]
}

export interface BatchDeleteResult {
  removedIds: string[]
  failedIds: string[]
}

export interface BookDetails {
  id: string
  bookId: string
  libraryState: LibraryState
  title: string
  author: string
  authors: BookAuthor[]
  isbn: string | null
  coverPath: string | null
  description: string | null
  rating: number | null
  note: string | null
  location: BookLocation | null
  lastKnownLocation?: string | null
  readingProgress: ReadingProgress
  userTags: BookTag[]
  suggestedTags: BookTag[]
  publishDate: string | null
  publishers: string | null
  numberOfPages: number | null
  openLibraryKey: string | null
  workKey: string | null
  addedAt: Date | string
  activeLoan: ActiveLoanSummary | null
}

export type LoanStatus = 'active' | 'returned' | 'canceled'
export type LoanInviteDeliveryStatus = 'not_requested' | 'unavailable' | 'sent' | 'failed'

export interface ActiveLoanSummary {
  id: string
  borrowerDisplayName: string
  acceptedByName: string | null
  loanedAt: Date | string
  dueAt: Date | string | null
  acceptedAt: Date | string | null
}

export interface OwnerLoan extends ActiveLoanSummary {
  userBookId: string
  ownerDisplayName: string
  status: LoanStatus
  returnedAt: Date | string | null
  canceledAt: Date | string | null
  book: {
    title: string
    author: string
    coverPath: string | null
  }
  inviteUrl: string | null
  deliveryStatus: LoanInviteDeliveryStatus
}

export interface BorrowedBook {
  id: string
  status: LoanStatus
  title: string
  author: string
  coverPath: string | null
  ownerName: string
  loanedAt: Date | string
  dueAt: Date | string | null
  returnedAt: Date | string | null
  acceptedAt: Date | string
  ownerRemoved: boolean
}

export interface InvitePreview {
  title: string
  author: string
  coverPath: string | null
  ownerName: string
  dueAt: Date | string | null
  canAccept: boolean
  isOwnInvite: boolean
  status: 'available' | 'already_accepted' | 'unavailable'
}

export interface AuthorLibrary {
  author: BookAuthor
  items: LibraryBook[]
  pagination: {
    page: number
    pageSize: number
    totalItems: number
    totalPages: number
    hasMore: boolean
  }
}

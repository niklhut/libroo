export type BulkScanReviewTarget = 'owned' | 'wishlisted'

export interface BulkScanReviewActionState {
  visible: boolean
  label: string
  hasPendingLookups: boolean
  isAdding: boolean
}

/** Derives the persistent bulk-add action state without coupling it to the UI. */
export function getBulkScanReviewAction(options: {
  selected: number
  loading: number
  isAdding: boolean
  targetLibraryState?: BulkScanReviewTarget
}): BulkScanReviewActionState {
  const target = options.targetLibraryState === 'wishlisted' ? 'Wishlist' : 'Library'
  const bookLabel = options.selected === 1 ? 'Book' : 'Books'

  return {
    visible: options.selected > 0,
    label: `Add ${options.selected} ${bookLabel} to ${target}`,
    hasPendingLookups: options.loading > 0,
    isAdding: options.isAdding
  }
}

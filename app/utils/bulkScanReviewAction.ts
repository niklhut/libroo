export type BulkScanReviewTarget = 'owned' | 'wishlisted'

export interface BulkScanReviewActionState {
  visible: boolean
  label: string
  buttonLabel: string
  statusMessage: string
  hasPendingLookups: boolean
  isDisabled: boolean
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
  const label = `Add ${options.selected} ${bookLabel} to ${target}`
  const hasPendingLookups = options.loading > 0

  return {
    visible: options.selected > 0,
    label,
    buttonLabel: hasPendingLookups ? 'Finishing lookups…' : label,
    statusMessage: hasPendingLookups
      ? `${options.selected} ${bookLabel.toLowerCase()} selected. Finishing all pending lookups before adding.`
      : `${options.selected} ${bookLabel.toLowerCase()} selected. ${label}.`,
    hasPendingLookups,
    isDisabled: hasPendingLookups || options.isAdding,
    isAdding: options.isAdding
  }
}

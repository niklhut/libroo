import { describe, expect, it } from 'vitest'
import { getBulkScanReviewAction } from '../../app/utils/bulkScanReviewAction'

describe('getBulkScanReviewAction', () => {
  it('hides the action when no books are selected', () => {
    expect(getBulkScanReviewAction({ selected: 0, loading: 0, isAdding: false })).toMatchObject({
      visible: false,
      label: 'Add 0 Books to Library'
    })
  })

  it('uses singular and plural labels for the library target', () => {
    expect(getBulkScanReviewAction({ selected: 1, loading: 0, isAdding: false }).label).toBe('Add 1 Book to Library')
    expect(getBulkScanReviewAction({ selected: 2, loading: 0, isAdding: false }).label).toBe('Add 2 Books to Library')
  })

  it('uses the wishlist target when selected', () => {
    expect(getBulkScanReviewAction({
      selected: 3,
      loading: 0,
      isAdding: false,
      targetLibraryState: 'wishlisted'
    }).label).toBe('Add 3 Books to Wishlist')
  })

  it('reflects pending lookups and additions without hiding a valid action', () => {
    expect(getBulkScanReviewAction({ selected: 1, loading: 2, isAdding: true })).toMatchObject({
      visible: true,
      hasPendingLookups: true,
      isAdding: true
    })
  })
})

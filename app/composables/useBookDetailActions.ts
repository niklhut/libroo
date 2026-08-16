import type { Ref } from 'vue'

export function useBookDetailActions(
  userBookId: string,
  book: Ref<BookDetails | null | undefined>,
  refresh: () => Promise<unknown>
) {
  const toast = useToast()
  const isDeleting = ref(false)
  const isReturningLoan = ref(false)
  const isSavingReadingProgress = ref(false)
  const isSavingBookNote = ref(false)
  const isSavingLoanNote = ref(false)
  const isSavingRating = ref(false)
  const isUpdatingLibraryState = ref(false)

  async function removeBook(confirmActiveLoan = false): Promise<'removed' | 'active-loan' | 'failed'> {
    isDeleting.value = true
    try {
      await $fetch(`/api/books/${userBookId}`, {
        method: 'DELETE',
        query: confirmActiveLoan ? { confirmActiveLoan: 'true' } : undefined
      })
      toast.add({ title: 'Book removed', color: 'success' })
      await navigateTo('/library')
      return 'removed'
    } catch (error: unknown) {
      const statusCode = (error as { statusCode?: number, data?: { statusCode?: number } })?.statusCode
        ?? (error as { data?: { statusCode?: number } })?.data?.statusCode
      if (statusCode === 409 && book.value?.activeLoan && !confirmActiveLoan) {
        return 'active-loan'
      }
      toast.add({ title: 'Could not remove book', color: 'error' })
      return 'failed'
    } finally {
      isDeleting.value = false
    }
  }

  async function updateBookLibraryState(state: LibraryState) {
    if (!book.value || isUpdatingLibraryState.value) return
    isUpdatingLibraryState.value = true
    try {
      await $fetch(`/api/books/${userBookId}/state`, {
        method: 'PUT',
        body: { state }
      })
      await refresh()
      toast.add({
        title: state === 'owned' ? 'Moved to library' : state === 'wishlisted' ? 'Moved to wishlist' : 'Marked previously owned',
        color: 'success'
      })
    } catch {
      toast.add({ title: 'Could not update book state', color: 'error' })
    } finally {
      isUpdatingLibraryState.value = false
    }
  }

  async function saveBookNote(note: string): Promise<boolean> {
    if (!book.value) return false
    isSavingBookNote.value = true
    try {
      await $fetch(`/api/books/${userBookId}/note`, {
        method: 'PUT',
        body: { note: note.trim() || null }
      })
      await refresh()
      toast.add({ title: note.trim() ? 'Note saved' : 'Note removed', color: 'success' })
      return true
    } catch {
      toast.add({ title: 'Could not save note', color: 'error' })
      return false
    } finally {
      isSavingBookNote.value = false
    }
  }

  async function saveLoanNote(note: string): Promise<boolean> {
    const loan = book.value?.activeLoan
    if (!loan) return false
    isSavingLoanNote.value = true
    try {
      await $fetch(`/api/loans/${loan.id}/note`, {
        method: 'PUT',
        body: { note: note.trim() || null }
      })
      await refresh()
      toast.add({ title: note.trim() ? 'Loan note saved' : 'Loan note removed', color: 'success' })
      return true
    } catch {
      toast.add({ title: 'Could not save loan note', color: 'error' })
      return false
    } finally {
      isSavingLoanNote.value = false
    }
  }

  async function returnActiveLoan() {
    const loan = book.value?.activeLoan
    if (!loan || isReturningLoan.value) return
    isReturningLoan.value = true
    try {
      await $fetch(`/api/loans/${loan.id}/return`, { method: 'POST' })
      await refresh()
      toast.add({ title: 'Book marked as returned', color: 'success' })
    } catch {
      toast.add({ title: 'Could not update lending status', color: 'error' })
    } finally {
      isReturningLoan.value = false
    }
  }

  async function saveReadingProgress(progress: ReadingProgress): Promise<boolean> {
    isSavingReadingProgress.value = true
    try {
      await $fetch(`/api/books/${userBookId}/reading`, { method: 'PUT', body: progress })
      await refresh()
      toast.add({ title: 'Progress saved', color: 'success' })
      return true
    } catch {
      toast.add({ title: 'Could not save reading progress', color: 'error' })
      return false
    } finally {
      isSavingReadingProgress.value = false
    }
  }

  async function saveRating(rating: number | null) {
    if (!book.value || isSavingRating.value) return
    const previousRating = book.value.rating
    book.value = { ...book.value, rating }
    isSavingRating.value = true
    try {
      await $fetch(`/api/books/${userBookId}/rating`, { method: 'PUT', body: { rating } })
    } catch {
      book.value = { ...book.value, rating: previousRating }
      toast.add({ title: 'Could not save rating', color: 'error' })
    } finally {
      isSavingRating.value = false
    }
  }

  return {
    isDeleting,
    isReturningLoan,
    isSavingReadingProgress,
    isSavingBookNote,
    isSavingLoanNote,
    isSavingRating,
    isUpdatingLibraryState,
    removeBook,
    updateBookLibraryState,
    saveBookNote,
    saveLoanNote,
    returnActiveLoan,
    saveReadingProgress,
    saveRating
  }
}

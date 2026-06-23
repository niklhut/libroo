import { extractIsbn } from '~~/shared/utils/schemas'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useLibraryDashboardStore } from './libraryDashboard'

export interface ScannedBook {
  isbn: string
  status: 'pending' | 'loading' | 'found' | 'not_found' | 'error' | 'already_owned'
  result?: BookLookupResult
  selected: boolean
  errorMessage?: string
}

export const useIsbnScannerStore = defineStore('isbn-scanner', () => {
  const toast = useToast()
  const dashboardStore = useLibraryDashboardStore()

  const scannedBooks = ref<ScannedBook[]>([])
  const isLookingUp = ref(false)
  const isAddingBooks = ref(false)

  function getErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof Error) {
      return err.message
    }
    return (err as { data?: { message?: string } })?.data?.message || fallback
  }

  const lookupUnavailableMessage = 'We could not look up this ISBN right now. Try again in a moment.'
  const addUnavailableMessage = 'Could not add this book to your library. Try again in a moment.'

  async function lookupScannedBook(book: ScannedBook) {
    book.status = 'loading'
    book.selected = true
    book.errorMessage = undefined
    book.result = undefined

    try {
      const result = await $fetch<BookLookupResult>('/api/books/lookup', {
        method: 'POST',
        body: { isbn: book.isbn }
      })

      book.result = result
      if (result.found) {
        book.status = result.existsLocally ? 'already_owned' : 'found'
        if (result.existsLocally) {
          book.selected = false
        }
      } else {
        book.status = 'not_found'
        book.selected = false
      }
    } catch {
      book.status = 'error'
      book.selected = false
      book.errorMessage = lookupUnavailableMessage
    }
  }

  async function addIsbn(rawIsbn: string) {
    const normalizedIsbn = extractIsbn(rawIsbn) || rawIsbn.replace(/[-\s]/g, '')

    if (scannedBooks.value.some(book => book.isbn === normalizedIsbn)) {
      toast.add({
        title: 'Already scanned',
        description: `ISBN ${normalizedIsbn} is already in the list`,
        color: 'warning'
      })
      return
    }

    const newBook: ScannedBook = {
      isbn: normalizedIsbn,
      status: 'loading',
      selected: true
    }
    scannedBooks.value.unshift(newBook)

    await lookupScannedBook(newBook)
  }

  async function retryIsbn(isbn: string) {
    const book = scannedBooks.value.find(b => b.isbn === isbn)
    if (!book || book.status === 'loading') return

    await lookupScannedBook(book)
  }

  async function addMultipleIsbns(text: string) {
    const inputs = text
      .split(/[\n,\s]+/)
      .map(s => s.trim().replace(/[-\s]/g, ''))
      .filter(s => s.length > 0)

    if (inputs.length === 0) {
      toast.add({
        title: 'No input',
        description: 'Please enter at least one ISBN',
        color: 'warning'
      })
      return
    }

    isLookingUp.value = true

    try {
      await Promise.all(inputs.map(isbn => addIsbn(isbn)))
    } finally {
      isLookingUp.value = false
    }
  }

  function removeIsbn(isbn: string) {
    const index = scannedBooks.value.findIndex(b => b.isbn === isbn)
    if (index !== -1) {
      scannedBooks.value.splice(index, 1)
    }
  }

  function toggleSelection(isbn: string) {
    const book = scannedBooks.value.find(b => b.isbn === isbn)
    if (book && book.status === 'found') {
      book.selected = !book.selected
    }
  }

  function selectAll() {
    scannedBooks.value.forEach((book) => {
      if (book.status === 'found') {
        book.selected = true
      }
    })
  }

  function deselectAll() {
    scannedBooks.value.forEach((book) => {
      book.selected = false
    })
  }

  async function addSelectedToLibrary(): Promise<{ success: string[], failed: string[] }> {
    const selectedBooks = scannedBooks.value.filter(
      book => book.selected && book.status === 'found'
    )

    if (selectedBooks.length === 0) {
      toast.add({
        title: 'No books selected',
        description: 'Please select at least one book to add',
        color: 'warning'
      })
      return { success: [], failed: [] }
    }

    isAddingBooks.value = true

    try {
      const result = await $fetch<{ added: Array<{ isbn: string }>, failed: Array<{ isbn: string, error: string }> }>('/api/books/bulk-add', {
        method: 'POST',
        body: {
          books: selectedBooks.map(book => ({
            isbn: book.isbn,
            previewCoverPath: book.result?.previewCoverPath ?? null
          }))
        }
      })

      const success = result.added.map(b => b.isbn)
      const failed = result.failed.map(b => b.isbn)

      success.forEach(isbn => removeIsbn(isbn))

      result.failed.forEach((f) => {
        const book = scannedBooks.value.find(b => b.isbn === f.isbn)
        if (book) {
          if (f.error === 'BookAlreadyOwnedError') {
            book.status = 'already_owned'
            book.selected = false
            book.errorMessage = 'This book is already in your library.'
          } else {
            book.status = 'found'
            book.selected = true
            book.errorMessage = addUnavailableMessage
          }
        }
      })

      isAddingBooks.value = false

      if (success.length > 0 && failed.length === 0) {
        toast.add({
          title: success.length === 1 ? 'Book added!' : 'Books added!',
          description: `Successfully added ${success.length} book${success.length > 1 ? 's' : ''} to your library`,
          color: 'success'
        })
      } else if (success.length > 0 && failed.length > 0) {
        toast.add({
          title: 'Partial success',
          description: `Added ${success.length}, failed ${failed.length}`,
          color: 'warning'
        })
      } else if (failed.length > 0) {
        toast.add({
          title: 'Failed to add books',
          description: `Could not add ${failed.length} book${failed.length > 1 ? 's' : ''}`,
          color: 'error'
        })
      }

      if (success.length > 0) {
        dashboardStore.markNeedsSync(dashboardStore.getLoadedPages())
      }

      return { success, failed }
    } catch (err: unknown) {
      isAddingBooks.value = false
      const message = getErrorMessage(err, 'Failed to add books')
      toast.add({
        title: 'Error',
        description: message,
        color: 'error'
      })
      return { success: [], failed: selectedBooks.map(b => b.isbn) }
    }
  }

  function clearAll() {
    scannedBooks.value = []
  }

  const counts = computed(() => ({
    total: scannedBooks.value.length,
    selected: scannedBooks.value.filter(b => b.selected).length,
    found: scannedBooks.value.filter(b => b.status === 'found').length,
    loading: scannedBooks.value.filter(b => b.status === 'loading').length,
    notFound: scannedBooks.value.filter(b => b.status === 'not_found').length,
    alreadyOwned: scannedBooks.value.filter(b => b.status === 'already_owned').length,
    errors: scannedBooks.value.filter(b => b.status === 'error').length
  }))

  return {
    scannedBooks,
    isLookingUp,
    isAddingBooks,
    counts,
    addIsbn,
    retryIsbn,
    addMultipleIsbns,
    removeIsbn,
    toggleSelection,
    selectAll,
    deselectAll,
    addSelectedToLibrary,
    clearAll
  }
})

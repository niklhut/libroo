/**
 * Composable for managing ISBN scanning and bulk lookup state
 */
import { extractIsbn } from '~~/shared/utils/schemas'

export interface ScannedBook {
  isbn: string
  status: 'pending' | 'loading' | 'found' | 'not_found' | 'error' | 'already_owned'
  result?: BookLookupResult
  selected: boolean
  errorMessage?: string
}

export function useIsbnScanner() {
  const toast = useToast()

  const scannedBooks = ref<ScannedBook[]>([])
  const isLookingUp = ref(false)
  const isAddingBooks = ref(false)

  /**
   * Extract error message from unknown error type
   */
  function getErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof Error) {
      return err.message
    }
    return (err as { data?: { message?: string } })?.data?.message || fallback
  }

  /**
   * Add an ISBN to the queue and immediately look it up
   */
  async function addIsbn(rawIsbn: string) {
    // Extract valid ISBN from barcode (handles price codes like "9781234567890 59099")
    const normalizedIsbn = extractIsbn(rawIsbn) || rawIsbn.replace(/[-\s]/g, '')

    // Check if already in queue
    if (scannedBooks.value.some(book => book.isbn === normalizedIsbn)) {
      toast.add({
        title: 'Already scanned',
        description: `ISBN ${normalizedIsbn} is already in the list`,
        color: 'warning'
      })
      return
    }

    // Add to queue with loading state - unshift to add newest at top
    const newBook: ScannedBook = {
      isbn: normalizedIsbn,
      status: 'loading',
      selected: true
    }
    scannedBooks.value.unshift(newBook)

    // Look up the book
    try {
      const result = await $fetch<BookLookupResult>('/api/books/lookup', {
        method: 'POST',
        body: { isbn: normalizedIsbn }
      })

      const book = scannedBooks.value.find(b => b.isbn === normalizedIsbn)
      if (book) {
        book.result = result
        if (result.found) {
          book.status = result.existsLocally ? 'already_owned' : 'found'
          // Auto-deselect if already owned
          if (result.existsLocally) {
            book.selected = false
          }
        } else {
          book.status = 'not_found'
          book.selected = false
        }
      }
    } catch (err: unknown) {
      const book = scannedBooks.value.find(b => b.isbn === normalizedIsbn)
      if (book) {
        book.status = 'error'
        book.selected = false
        book.errorMessage = getErrorMessage(err, 'Lookup failed')
      }
    }
  }

  /**
   * Add multiple ISBNs from text input (comma or newline separated)
   * Let the backend handle validation - it's the single source of truth
   */
  async function addMultipleIsbns(text: string) {
    // Parse text into individual strings (comma, newline, or space separated)
    // Remove hyphens/spaces but don't validate - backend will handle that
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
      // Add all inputs in parallel - backend will validate each one
      await Promise.all(inputs.map(isbn => addIsbn(isbn)))
    } finally {
      isLookingUp.value = false
    }
  }

  /**
   * Remove an ISBN from the queue
   */
  function removeIsbn(isbn: string) {
    const index = scannedBooks.value.findIndex(b => b.isbn === isbn)
    if (index !== -1) {
      scannedBooks.value.splice(index, 1)
    }
  }

  /**
   * Toggle selection of a book
   */
  function toggleSelection(isbn: string) {
    const book = scannedBooks.value.find(b => b.isbn === isbn)
    if (book && book.status === 'found') {
      book.selected = !book.selected
    }
  }

  /**
   * Select all available books
   */
  function selectAll() {
    scannedBooks.value.forEach((book) => {
      if (book.status === 'found') {
        book.selected = true
      }
    })
  }

  /**
   * Deselect all books
   */
  function deselectAll() {
    scannedBooks.value.forEach((book) => {
      book.selected = false
    })
  }

  /**
   * Add all selected books to the library
   */
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

    // Use bulk-add endpoint with backend concurrency
    try {
      const isbns = selectedBooks.map(b => b.isbn)
      const result = await $fetch<{ added: Array<{ isbn: string }>, failed: Array<{ isbn: string, error: string }> }>('/api/books/bulk-add', {
        method: 'POST',
        body: { isbns }
      })

      const success = result.added.map(b => b.isbn)
      const failed = result.failed.map(b => b.isbn)

      // Remove successful books from queue
      success.forEach(isbn => removeIsbn(isbn))

      // Update failed books with error status
      result.failed.forEach((f) => {
        const book = scannedBooks.value.find(b => b.isbn === f.isbn)
        if (book) {
          book.status = 'error'
          book.selected = false
          book.errorMessage = f.error
        }
      })

      isAddingBooks.value = false

      // Show summary toast
      if (success.length > 0 && failed.length === 0) {
        toast.add({
          title: 'Books added!',
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

  /**
   * Clear all scanned books
   */
  function clearAll() {
    scannedBooks.value = []
  }

  /**
   * Get counts for UI display
   */
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
    addMultipleIsbns,
    removeIsbn,
    toggleSelection,
    selectAll,
    deselectAll,
    addSelectedToLibrary,
    clearAll
  }
}

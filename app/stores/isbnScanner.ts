import type { LibraryState } from '~~/shared/types/book'
import { extractIsbn } from '~~/shared/utils/schemas'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useIsbnLookupStore } from './isbnLookup'

export interface ScannedBook {
  isbn: string
  status: 'pending' | 'loading' | 'found' | 'not_found' | 'error' | 'already_owned'
  result?: BookLookupResult
  selected: boolean
  errorMessage?: string
}

export const useIsbnScannerStore = defineStore('isbn-scanner', () => {
  const toast = useToast()
  const isbnLookupStore = useIsbnLookupStore()

  const scannedBooks = ref<ScannedBook[]>([])
  const isBulkLookingUp = ref(false)
  const targetLibraryState = ref<LibraryState>('owned')

  const lookupUnavailableMessage = 'We could not look up this ISBN right now. Try again in a moment.'
  const addUnavailableMessage = 'Could not add this book to your library. Try again in a moment.'

  const isLookingUp = computed(() => isBulkLookingUp.value || isbnLookupStore.isLookingUp)
  const isAddingBooks = computed(() => isbnLookupStore.isAdding)

  async function lookupScannedBook(book: ScannedBook) {
    book.status = 'loading'
    book.selected = true
    book.errorMessage = undefined
    book.result = undefined

    const lookup = await isbnLookupStore.lookupIsbn(book.isbn, {
      fallbackMessage: lookupUnavailableMessage
    })

    if (!lookup.ok) {
      book.status = 'error'
      book.selected = false
      book.errorMessage = lookupUnavailableMessage
      return
    }

    book.result = lookup.result
    if (lookup.result.found) {
      book.status = lookup.result.existsLocally ? 'already_owned' : 'found'
      if (lookup.result.existsLocally) {
        book.selected = false
      }
    } else {
      book.status = 'not_found'
      book.selected = false
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

    const reactiveBook = scannedBooks.value.find(book => book.isbn === normalizedIsbn)
    if (reactiveBook) {
      await lookupScannedBook(reactiveBook)
    }
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

    isBulkLookingUp.value = true

    try {
      await Promise.all(inputs.map(isbn => addIsbn(isbn)))
    } finally {
      isBulkLookingUp.value = false
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

    const result = await isbnLookupStore.addIsbnsToLibrary(selectedBooks.map(book => book.isbn), targetLibraryState.value)
    const success = result.success
    const failed = result.failedIsbns

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

    if (success.length > 0 && failed.length === 0) {
      toast.add({
        title: success.length === 1 ? 'Book added!' : 'Books added!',
        description: targetLibraryState.value === 'wishlisted'
          ? `Successfully added ${success.length} book${success.length > 1 ? 's' : ''} to your wishlist`
          : `Successfully added ${success.length} book${success.length > 1 ? 's' : ''} to your library`,
        color: 'success'
      })
    } else if (success.length > 0 && failed.length > 0) {
      toast.add({
        title: 'Partial success',
        description: `Added ${success.length}, failed ${failed.length}`,
        color: 'warning'
      })
    } else if (failed.length > 0) {
      const requestFailed = isbnLookupStore.addError !== null && success.length === 0
      toast.add({
        title: requestFailed ? 'Error' : 'Failed to add books',
        description: requestFailed
          ? isbnLookupStore.addError || 'Failed to add books'
          : `Could not add ${failed.length} book${failed.length > 1 ? 's' : ''}`,
        color: 'error'
      })
    }

    return { success, failed }
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
    targetLibraryState,
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

import { useIsbnLookupStore } from '~/stores/isbnLookup'
import { useIsbnScannerStore } from '~/stores/isbnScanner'
import { useLibraryDashboardStore } from '~/stores/libraryDashboard'

export function useClearUserScopedState() {
  const dashboardStore = useLibraryDashboardStore()
  const scannerStore = useIsbnScannerStore()
  const lookupStore = useIsbnLookupStore()

  function clearUserScopedState() {
    dashboardStore.resetAll()
    scannerStore.clearAll()
    lookupStore.reset()
  }

  return { clearUserScopedState }
}

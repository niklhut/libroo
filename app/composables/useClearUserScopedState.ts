import { useIsbnScannerStore } from '~/stores/isbnScanner'
import { useLibraryDashboardStore } from '~/stores/libraryDashboard'

export function useClearUserScopedState() {
  const dashboardStore = useLibraryDashboardStore()
  const scannerStore = useIsbnScannerStore()

  function clearUserScopedState() {
    dashboardStore.resetAll()
    scannerStore.clearAll()
  }

  return { clearUserScopedState }
}

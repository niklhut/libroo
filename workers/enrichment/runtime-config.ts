/** Minimal Nuxt runtime-config adapter for the standalone Worker bundle. */
export function useRuntimeConfig() {
  return {
    openLibraryContactEmail: undefined,
    openLibraryRequestTimeoutSeconds: '12',
    openLibraryCoverTimeoutSeconds: '20'
  }
}

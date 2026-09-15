declare module '#imports' {
  export function useRuntimeConfig(): {
    booksEnrichmentBatchSize?: string
    booksEnrichmentConcurrency?: string
    openLibraryRequestTimeoutSeconds?: string
    openLibraryCoverTimeoutSeconds?: string
    openLibraryContactEmail?: string
  }
}

declare function useRuntimeConfig(): {
  openLibraryContactEmail?: string
  openLibraryRequestTimeoutSeconds?: string
  openLibraryCoverTimeoutSeconds?: string
}

export function useReadingSummary(
  progress: ReadingProgress | null | undefined,
  numberOfPages: number | null | undefined
): string {
  if (!progress || progress.status === 'unread') return 'Unread'
  if (progress.status === 'read') return 'Finished'

  return progress.currentPage !== null && numberOfPages
    ? `${progress.currentPage} of ${numberOfPages} pages`
    : `${progress.progressPercent ?? 0}% complete`
}

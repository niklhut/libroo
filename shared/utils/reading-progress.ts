import type { ReadingProgress, ReadingStatus } from '../types/book'

interface ReadingProgressInput {
  status?: ReadingStatus
  currentPage?: number | null
  progressPercent?: number | null
  startedAt?: Date | string | null
  finishedAt?: Date | string | null
}

interface ReadingProgressDetails {
  numberOfPages: number | null
  readingProgress: ReadingProgress
}

export function normalizeReadingProgress(
  details: ReadingProgressDetails,
  input: ReadingProgressInput,
  now = new Date()
): ReadingProgress {
  const totalPages = details.numberOfPages
  const existing = details.readingProgress

  const inputCurrentPage = input.currentPage !== undefined ? input.currentPage : existing.currentPage
  const inputPercent = input.progressPercent !== undefined ? input.progressPercent : existing.progressPercent
  let currentPage = inputCurrentPage
  let progressPercent = inputPercent
  let status = input.status ?? existing.status
  let startedAt = input.startedAt !== undefined ? input.startedAt : existing.startedAt
  let finishedAt = input.finishedAt !== undefined ? input.finishedAt : existing.finishedAt
  const hasExplicitCurrentPage = input.currentPage !== undefined && input.currentPage !== null
  const hasExplicitPercent = input.progressPercent !== undefined && input.progressPercent !== null

  if (currentPage !== null && totalPages !== null && currentPage > totalPages) {
    throw new Error(`Current page cannot exceed ${totalPages}`)
  }

  if (hasExplicitPercent && progressPercent !== null) {
    progressPercent = Math.min(100, Math.max(0, Math.round(progressPercent)))
  } else if (currentPage !== null && totalPages !== null && totalPages > 0) {
    progressPercent = Math.min(100, Math.round((currentPage / totalPages) * 100))
  }

  if (currentPage !== null && currentPage > 0 && status === 'unread') {
    status = 'reading'
  }

  if (progressPercent !== null && progressPercent > 0 && status === 'unread') {
    status = 'reading'
  }

  if (
    status === 'read'
    && (
      (hasExplicitPercent && progressPercent !== null && progressPercent < 100)
      || (hasExplicitCurrentPage && totalPages !== null && totalPages > 0 && currentPage !== null && currentPage < totalPages)
    )
  ) {
    status = 'reading'
  }

  if (
    progressPercent === 100
    || (currentPage !== null && totalPages !== null && totalPages > 0 && currentPage >= totalPages)
    || status === 'read'
  ) {
    status = 'read'
    progressPercent = 100
    currentPage = totalPages ?? currentPage
    startedAt = startedAt ?? now
    finishedAt = finishedAt ?? now
  } else if (status === 'reading') {
    startedAt = startedAt ?? now
    finishedAt = null
  } else if (status === 'unread') {
    currentPage = null
    progressPercent = null
    startedAt = null
    finishedAt = null
  }

  return {
    status,
    currentPage,
    progressPercent,
    startedAt,
    finishedAt
  }
}

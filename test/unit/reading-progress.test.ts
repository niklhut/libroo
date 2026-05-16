import { describe, expect, it } from 'vitest'
import { normalizeReadingProgress } from '../../shared/utils/reading-progress'
import type { ReadingProgress } from '../../shared/types/book'

const now = new Date('2026-05-14T12:00:00.000Z')

const readProgress: ReadingProgress = {
  status: 'read',
  currentPage: 200,
  progressPercent: 100,
  startedAt: '2026-05-01T00:00:00.000Z',
  finishedAt: '2026-05-10T00:00:00.000Z'
}

describe('normalizeReadingProgress', () => {
  it('moves a completed book back to reading when page progress is lowered', () => {
    expect(normalizeReadingProgress(
      {
        numberOfPages: 200,
        readingProgress: readProgress
      },
      {
        status: 'read',
        currentPage: 120,
        progressPercent: null
      },
      now
    )).toEqual({
      status: 'reading',
      currentPage: 120,
      progressPercent: 60,
      startedAt: '2026-05-01T00:00:00.000Z',
      finishedAt: null
    })
  })

  it('moves a completed book back to reading when percent progress is lowered', () => {
    expect(normalizeReadingProgress(
      {
        numberOfPages: 200,
        readingProgress: readProgress
      },
      {
        status: 'read',
        currentPage: null,
        progressPercent: 50
      },
      now
    )).toEqual({
      status: 'reading',
      currentPage: null,
      progressPercent: 50,
      startedAt: '2026-05-01T00:00:00.000Z',
      finishedAt: null
    })
  })

  it('keeps a book completed when page progress reaches the total', () => {
    expect(normalizeReadingProgress(
      {
        numberOfPages: 200,
        readingProgress: {
          status: 'reading',
          currentPage: 120,
          progressPercent: 60,
          startedAt: '2026-05-01T00:00:00.000Z',
          finishedAt: null
        }
      },
      {
        status: 'reading',
        currentPage: 200,
        progressPercent: null
      },
      now
    )).toEqual({
      status: 'read',
      currentPage: 200,
      progressPercent: 100,
      startedAt: '2026-05-01T00:00:00.000Z',
      finishedAt: now
    })
  })
})

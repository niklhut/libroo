import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cleanupApiRouteTest,
  importRoute,
  itRequiresAuth,
  makeEvent,
  mockLoggedInUser,
  routePath,
  serviceMocks,
  setupApiRouteTest
} from '../../_helpers/api-route'

const route = routePath('books/[id]/reading.put')

describe('server/api/books/[id]/reading.put', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { params: { id: 'ub-1' }, body: { status: 'reading' } })

  it('updates reading progress', async () => {
    mockLoggedInUser()
    const readingProgress = {
      status: 'reading',
      currentPage: 50,
      progressPercent: 25,
      startedAt: new Date('2026-05-01T00:00:00.000Z'),
      finishedAt: null
    }
    serviceMocks.updateReadingProgress.mockReturnValueOnce(Effect.succeed(readingProgress))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({
      params: { id: 'ub-1' },
      body: { status: 'reading', currentPage: 50 }
    }))).resolves.toEqual({ success: true, readingProgress })
    expect(serviceMocks.updateReadingProgress).toHaveBeenCalledWith('ub-1', 'user-1', {
      status: 'reading',
      currentPage: 50
    })
  })

  it('accepts percent updates while clearing page progress', async () => {
    mockLoggedInUser()
    const readingProgress = {
      status: 'reading',
      currentPage: null,
      progressPercent: 50,
      startedAt: new Date('2026-05-02T00:00:00.000Z'),
      finishedAt: null
    }
    serviceMocks.updateReadingProgress.mockReturnValueOnce(Effect.succeed(readingProgress))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({
      params: { id: 'ub-1' },
      body: { status: 'reading', currentPage: null, progressPercent: 50, startedAt: '2026-05-02' }
    }))).resolves.toEqual({ success: true, readingProgress })
    expect(serviceMocks.updateReadingProgress).toHaveBeenCalledWith('ub-1', 'user-1', {
      status: 'reading',
      currentPage: null,
      progressPercent: 50,
      startedAt: new Date('2026-05-02T00:00:00.000Z')
    })
  })

  it('accepts page updates while clearing percent progress', async () => {
    mockLoggedInUser()
    const readingProgress = {
      status: 'reading',
      currentPage: 120,
      progressPercent: 60,
      startedAt: new Date('2026-05-03T00:00:00.000Z'),
      finishedAt: null
    }
    serviceMocks.updateReadingProgress.mockReturnValueOnce(Effect.succeed(readingProgress))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({
      params: { id: 'ub-1' },
      body: { status: 'reading', currentPage: 120, progressPercent: null, startedAt: '2026-05-03' }
    }))).resolves.toEqual({ success: true, readingProgress })
    expect(serviceMocks.updateReadingProgress).toHaveBeenCalledWith('ub-1', 'user-1', {
      status: 'reading',
      currentPage: 120,
      progressPercent: null,
      startedAt: new Date('2026-05-03T00:00:00.000Z')
    })
  })

  it('rejects missing book ids', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ body: { status: 'reading' } }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Book ID is required'
    })
  })

  it('rejects invalid reading progress', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'ub-1' }, body: { progressPercent: 110 } }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Invalid reading progress'
    })
  })
})

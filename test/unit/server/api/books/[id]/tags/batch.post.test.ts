import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BATCH_TAG_UPDATE_MAX_ENTRIES } from '../../../../../../../shared/utils/schemas'
import {
  cleanupApiRouteTest,
  importRoute,
  itRequiresAuth,
  makeEvent,
  mockLoggedInUser,
  routePath,
  serviceMocks,
  setupApiRouteTest
} from '../../../_helpers/api-route'

const route = routePath('books/[id]/tags/batch.post')

describe('server/api/books/[id]/tags/batch.post', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { params: { id: 'ub-1' }, body: { deleteIds: [], promoteIds: [], createNames: [] } })

  it('batch-updates tags', async () => {
    mockLoggedInUser()
    serviceMocks.batchUpdateTags.mockReturnValueOnce(Effect.succeed(undefined))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({
      params: { id: 'ub-1' },
      body: { deleteIds: ['tag-1'], promoteIds: ['tag-2'], createNames: ['new'] }
    }))).resolves.toEqual({ success: true })
    expect(serviceMocks.batchUpdateTags).toHaveBeenCalledWith('ub-1', 'user-1', ['tag-1'], ['tag-2'], ['new'])
  })

  it('defaults omitted tag arrays to empty arrays', async () => {
    mockLoggedInUser()
    serviceMocks.batchUpdateTags.mockReturnValueOnce(Effect.succeed(undefined))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'ub-1' }, body: {} }))).resolves.toEqual({ success: true })
    expect(serviceMocks.batchUpdateTags).toHaveBeenCalledWith('ub-1', 'user-1', [], [], [])
  })

  it('rejects tag batches above the per-field limit', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({
      params: { id: 'ub-1' },
      body: { deleteIds: Array.from({ length: BATCH_TAG_UPDATE_MAX_ENTRIES + 1 }, (_, index) => `tag-${index}`) }
    }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Validation Error'
    })
  })

  it('rejects missing book ids', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ body: {} }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Book ID is required'
    })
  })
})

import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_BULK_ISBN_COUNT, MAX_BULK_ISBN_INPUT_BYTES } from '../../../../../shared/utils/schemas'
import {
  cleanupApiRouteTest,
  importRoute,
  itRejectsBannedUsers,
  itRequiresAuth,
  makeEvent,
  mockLoggedInUser,
  routePath,
  serviceMocks,
  setupApiRouteTest
} from '../_helpers/api-route'

const route = routePath('books/bulk-lookup.post')

describe('server/api/books/bulk-lookup.post', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { body: { isbns: ['9780306406157'] } })
  itRejectsBannedUsers(route, { body: { isbns: ['9780306406157'] } })

  it('passes raw ISBN inputs to the bulk service for per-item validation', async () => {
    mockLoggedInUser()
    const response = { items: [] }
    serviceMocks.bulkLookupBooks.mockReturnValueOnce(Effect.succeed(response))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({
      body: { isbns: ['978-0-306-40615-7', 'invalid'] }
    }))).resolves.toBe(response)
    expect(serviceMocks.bulkLookupBooks).toHaveBeenCalledWith('user-1', ['978-0-306-40615-7', 'invalid'])
  })

  it.each([
    { body: { isbns: [] } },
    { body: { isbns: Array.from({ length: MAX_BULK_ISBN_COUNT + 1 }, () => '9780306406157') } },
    { rawBody: '{bad json' },
    { rawBody: 'x'.repeat(MAX_BULK_ISBN_INPUT_BYTES + 1) }
  ])('rejects invalid or oversized envelopes', async (event) => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent(event))).rejects.toMatchObject({ statusCode: 400, message: 'Validation Error' })
    expect(serviceMocks.bulkLookupBooks).not.toHaveBeenCalled()
  })
})

import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

const route = routePath('library/export.get')

describe('server/api/library/export.get', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route)
  itRejectsBannedUsers(route)

  it('exports CSV for the authenticated user only', async () => {
    mockLoggedInUser({ id: 'session-user', name: 'Ada', email: 'ada@example.com' })
    serviceMocks.exportLibraryCsv.mockReturnValueOnce(Effect.succeed('title\nDune'))
    const handler = await importRoute(route)
    const event = makeEvent()

    await expect(handler(event)).resolves.toBe('title\nDune')
    expect(serviceMocks.exportLibraryCsv).toHaveBeenCalledWith('session-user')
    expect(event.responseHeaders['Content-Type']).toBe('text/csv; charset=utf-8')
    expect(event.responseHeaders['Content-Disposition']).toMatch(/^attachment; filename="libroo-library-\d{4}-\d{2}-\d{2}\.csv"$/)
  })
})

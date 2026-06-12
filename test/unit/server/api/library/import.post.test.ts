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

const route = routePath('library/import.post')

describe('server/api/library/import.post', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { body: { csv: 'title\nDune', conflictStrategy: 'existing' } })
  itRejectsBannedUsers(route, { body: { csv: 'title\nDune', conflictStrategy: 'existing' } })

  it('imports CSV for the authenticated user only', async () => {
    mockLoggedInUser({ id: 'session-user', name: 'Ada', email: 'ada@example.com' })
    const result = { created: 1, updated: 0, skipped: 0, failed: [] }
    serviceMocks.importLibraryCsv.mockReturnValueOnce(Effect.succeed(result))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({
      body: {
        csv: 'title,authors,isbn,tags,location,reading_status,current_page,progress_percent,rating,note,added_date,active_loan_status,active_loan_borrower,active_loan_loaned_at,active_loan_due_at\nDune,Frank Herbert,,,,unread,,,,,,,,,',
        conflictStrategy: 'csv'
      }
    }))).resolves.toBe(result)
    expect(serviceMocks.importLibraryCsv).toHaveBeenCalledWith(
      'session-user',
      expect.stringContaining('Dune'),
      'csv'
    )
  })
})

import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cleanupApiRouteTest,
  importRoute,
  itRejectsBannedUsers,
  itRequiresAuth,
  makeEvent,
  mockLoggedInAdmin,
  mockLoggedInUser,
  routePath,
  serviceMocks,
  setupApiRouteTest,
  testAdminUser
} from '../../_helpers/api-route'

const getRoute = routePath('admin/author-repair/index.get')
const postRoute = routePath('admin/author-repair/index.post')

describe('server/api/admin/author-repair', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(getRoute)
  itRejectsBannedUsers(getRoute)

  it('returns candidate count only through the admin service', async () => {
    mockLoggedInAdmin()
    serviceMocks.getUnknownAuthorRepairCandidateCount.mockReturnValueOnce(Effect.succeed(7))
    const handler = await importRoute(getRoute)

    await expect(handler(makeEvent())).resolves.toEqual({ candidateCount: 7 })
    expect(serviceMocks.getUnknownAuthorRepairCandidateCount).toHaveBeenCalledWith(testAdminUser)
  })

  it('rejects non-admin author repair requests', async () => {
    mockLoggedInUser()
    serviceMocks.repairUnknownOpenLibraryAuthors.mockReturnValueOnce(Effect.fail({ _tag: 'AdminForbiddenError' }))
    const handler = await importRoute(postRoute)

    await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 403 })
  })

  it('runs the bounded repair for admins', async () => {
    mockLoggedInAdmin()
    const result = { scanned: 3, repaired: 2, stillUnknown: 0, skipped: 1, failed: 0 }
    serviceMocks.repairUnknownOpenLibraryAuthors.mockReturnValueOnce(Effect.succeed(result))
    const handler = await importRoute(postRoute)

    await expect(handler(makeEvent())).resolves.toEqual(result)
    expect(serviceMocks.repairUnknownOpenLibraryAuthors).toHaveBeenCalledWith(testAdminUser)
  })
})
